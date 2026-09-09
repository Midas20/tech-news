// NewsTrack.exe -- the double-click, and nothing else.
//
// WHY THERE IS A C# FILE IN A TYPESCRIPT PROJECT
//
// Asked for on 2026-09-09: "I want exe file I can run on my PC". Windows will
// not double-click a .ts file, a .js file or an npm script, so something has to
// be a PE binary. The question is only which thing, and how little it can do.
//
// The obvious route was Node's Single Executable Application: bundle the
// launcher into a copy of node.exe with postject. It was tried first and it
// does not work here. postject loads the whole 92 MB binary into a LIEF wasm
// heap, and on this machine -- 8 GB, most of it held by Postgres and the
// collector -- it dies with "Fatal process out of memory: Zone" before it
// writes anything. Raising --max-old-space-size does not help, because the
// allocation that fails is wasm's, not V8's heap.
//
// So: csc.exe, which is part of the .NET Framework and therefore already on
// every Windows machine since Vista. No download, no npm dependency, no
// toolchain to install, and the result is 4 KB instead of 190 MB.
//
// WHAT IT DELIBERATELY DOES NOT DO
//
// Every decision about databases, migrations, ports and browsers lives in
// launch.ts, where it can be read, tested and changed without a compiler. This
// file finds node.exe, hands it the launcher, and returns its exit code. If it
// ever needs a second feature, that feature belongs on the other side of this
// boundary.

using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;

internal static class NewsTrack
{
    private const string Runtime = @"runtime\node.exe";
    private const string Launcher = @"app\src\launcher\launch.ts";

    // --- keeping the children with the parent --------------------------------
    //
    // Ctrl+C and closing the console reach every process on the console, so the
    // launcher shuts down properly in both. End task in Task Manager does not:
    // it terminates this process alone, and node.exe carries on serving, still
    // holding the port. The next launch then fails with "port already in use"
    // for a program the user believes they closed.
    //
    // A Job Object with KILL_ON_JOB_CLOSE is the Windows answer. The job handle
    // is owned by this process, so however this process dies -- cleanly, killed,
    // or crashed -- the handle closes and the kernel terminates everything in
    // the job. It is the only shutdown path that does not depend on this code
    // getting a chance to run.

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateJobObject(IntPtr attributes, string name);

    [DllImport("kernel32.dll")]
    private static extern bool SetInformationJobObject(
        IntPtr job, int infoClass, IntPtr info, uint length);

    [DllImport("kernel32.dll")]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    private const int ExtendedLimitInformation = 9;
    private const int LimitKillOnJobClose = 0x2000;

    private static IntPtr CreateKillOnCloseJob()
    {
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) return IntPtr.Zero;

        // JOBOBJECT_EXTENDED_LIMIT_INFORMATION. Only LimitFlags is set, and it
        // sits at offset 16 of the BASIC_LIMIT_INFORMATION that starts the
        // struct -- after two LARGE_INTEGERs. The rest stays zero.
        int size = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
        IntPtr info = Marshal.AllocHGlobal(size);
        try
        {
            var limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            limits.BasicLimitInformation.LimitFlags = LimitKillOnJobClose;
            Marshal.StructureToPtr(limits, info, false);
            if (!SetInformationJobObject(job, ExtendedLimitInformation, info, (uint)size))
            {
                return IntPtr.Zero;
            }
        }
        finally
        {
            Marshal.FreeHGlobal(info);
        }
        return job;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public int LimitFlags;
        public IntPtr MinimumWorkingSetSize;
        public IntPtr MaximumWorkingSetSize;
        public int ActiveProcessLimit;
        public IntPtr Affinity;
        public int PriorityClass;
        public int SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS
    {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
        public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public IntPtr ProcessMemoryLimit;
        public IntPtr JobMemoryLimit;
        public IntPtr PeakProcessMemoryUsed;
        public IntPtr PeakJobMemoryUsed;
    }

    private static int Main(string[] args)
    {
        // The folder the exe lives in, not the folder it was launched from.
        // Double-clicking from Explorer sets the working directory to wherever
        // the shortcut points, which is routinely somewhere else entirely.
        string home = Path.GetDirectoryName(
            Path.GetFullPath(Assembly.GetExecutingAssembly().Location));

        string node = Path.Combine(home, Runtime);
        string launcher = Path.Combine(home, Launcher);

        if (!File.Exists(node) || !File.Exists(launcher))
        {
            // A moved exe is the likely cause, and it is worth saying so
            // plainly: this is the one error a user can hit before any of the
            // real code runs, and it has exactly one fix.
            Console.Error.WriteLine("NewsTrack cannot find the files it ships with.");
            Console.Error.WriteLine();
            Console.Error.WriteLine("  looked for: " + node);
            Console.Error.WriteLine("  looked for: " + launcher);
            Console.Error.WriteLine();
            Console.Error.WriteLine("NewsTrack.exe runs from inside its own folder. Move the whole");
            Console.Error.WriteLine("folder, or make a shortcut to the exe -- but do not move the exe");
            Console.Error.WriteLine("out on its own.");
            Pause();
            return 2;
        }

        var start = new ProcessStartInfo
        {
            FileName = node,
            // --experimental-strip-types, because there is no build step: Node
            // erases the types and runs the file that is in the repository.
            Arguments = "--experimental-strip-types --no-warnings "
                        + Quote(launcher) + Rest(args),
            // Inherit this console rather than open another. The launcher's
            // output IS the app's output, and a second window that closes on
            // exit is where error messages go to be missed.
            UseShellExecute = false,
            WorkingDirectory = Path.Combine(home, "app"),
        };

        // Ctrl+C reaches every process attached to the console, so the child
        // already gets it. What this stops is *this* process racing the child
        // to exit: the launcher has a shutdown that stops Postgres, and it
        // needs the parent to still be waiting when it finishes.
        Console.CancelKeyPress += (sender, e) => { e.Cancel = true; };

        // Created before the child, so there is no window in which a process
        // exists outside the job.
        IntPtr job = CreateKillOnCloseJob();

        try
        {
            using (Process child = Process.Start(start))
            {
                // Best effort, deliberately. If the job could not be created --
                // an old Windows, an existing job that forbids nesting -- the
                // right outcome is a NewsTrack that runs and can be orphaned by
                // Task Manager, not one that refuses to start.
                if (job != IntPtr.Zero) AssignProcessToJobObject(job, child.Handle);

                child.WaitForExit();
                return child.ExitCode;
            }
        }
        catch (Exception err)
        {
            Console.Error.WriteLine("NewsTrack could not start: " + err.Message);
            Pause();
            return 3;
        }
    }

    private static string Rest(string[] args)
    {
        string joined = "";
        foreach (string arg in args) joined += " " + Quote(arg);
        return joined;
    }

    private static string Quote(string value)
    {
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }

    // Only on the failures above. A double-clicked window that vanishes has
    // told the user nothing, and these two errors are the ones reachable
    // before the launcher can print anything of its own.
    private static void Pause()
    {
        if (Console.IsInputRedirected) return;
        Console.Error.WriteLine();
        Console.Error.Write("Press Enter to close. ");
        Console.ReadLine();
    }
}
