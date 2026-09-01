// Where to learn each technology.
//
// Three questions, three kinds, because they are genuinely different documents:
//
//   official   the reference. Complete, precise, and usually a poor place to start.
//   tutorial   the way in. Often the project's own "getting started", sometimes not.
//   learning   free, substantial material by someone else.
//
// `free` is load-bearing. A course that paywalls after lesson two is not a free
// learning platform, and listing it as one wastes the reader's time twice.
//
// Nothing here is trusted on sight. Every URL is fetched by scripts/resources.ts
// before it is shown, and one that does not answer is kept with its status
// rather than displayed -- a dead link is worse than an absent one, because the
// reader has to click it to find that out.

export interface ResourceSeed {
  kind: 'official' | 'tutorial' | 'learning' | 'reference' | 'community';
  title: string;
  url: string;
  /** Who publishes it. 'official' means the project itself. */
  provider?: string;
  free?: boolean;
  order?: number;
}

type Seeds = Record<string, ResourceSeed[]>;

/** Resources that apply to a whole family, applied to a root and inherited. */
export const CURATED: Seeds = {
  // --- languages -------------------------------------------------------------
  javascript: [
    { kind: 'official', title: 'MDN JavaScript reference', url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript', provider: 'MDN' },
    { kind: 'tutorial', title: 'MDN JavaScript first steps', url: 'https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Scripting', provider: 'MDN' },
    { kind: 'learning', title: 'The Modern JavaScript Tutorial', url: 'https://javascript.info/', provider: 'javascript.info' },
    { kind: 'learning', title: 'Eloquent JavaScript', url: 'https://eloquentjavascript.net/', provider: 'Marijn Haverbeke' },
  ],
  typescript: [
    { kind: 'official', title: 'TypeScript documentation', url: 'https://www.typescriptlang.org/docs/' },
    { kind: 'tutorial', title: 'TypeScript for JavaScript programmers', url: 'https://www.typescriptlang.org/docs/handbook/typescript-in-5-minutes.html' },
    { kind: 'learning', title: 'Total TypeScript essentials', url: 'https://www.totaltypescript.com/books/total-typescript-essentials', provider: 'Matt Pocock' },
  ],
  python: [
    { kind: 'official', title: 'Python 3 documentation', url: 'https://docs.python.org/3/' },
    { kind: 'tutorial', title: 'The Python Tutorial', url: 'https://docs.python.org/3/tutorial/' },
    { kind: 'learning', title: 'Automate the Boring Stuff with Python', url: 'https://automatetheboringstuff.com/', provider: 'Al Sweigart' },
    { kind: 'learning', title: 'Real Python tutorials', url: 'https://realpython.com/', provider: 'Real Python' },
  ],
  rust: [
    { kind: 'official', title: 'The Rust reference', url: 'https://doc.rust-lang.org/reference/' },
    { kind: 'tutorial', title: 'The Rust Programming Language', url: 'https://doc.rust-lang.org/book/' },
    { kind: 'learning', title: 'Rust by Example', url: 'https://doc.rust-lang.org/rust-by-example/' },
    { kind: 'learning', title: 'Rustlings exercises', url: 'https://github.com/rust-lang/rustlings' },
  ],
  go: [
    { kind: 'official', title: 'Go documentation', url: 'https://go.dev/doc/' },
    { kind: 'tutorial', title: 'A Tour of Go', url: 'https://go.dev/tour/' },
    { kind: 'learning', title: 'Go by Example', url: 'https://gobyexample.com/', provider: 'Mark McGranaghan' },
    { kind: 'learning', title: 'Learn Go with Tests', url: 'https://quii.gitbook.io/learn-go-with-tests', provider: 'Chris James' },
  ],
  java: [
    { kind: 'official', title: 'Java SE documentation', url: 'https://docs.oracle.com/en/java/javase/', provider: 'Oracle' },
    { kind: 'tutorial', title: 'The Java Tutorials', url: 'https://dev.java/learn/' },
    { kind: 'learning', title: 'Baeldung Java guides', url: 'https://www.baeldung.com/', provider: 'Baeldung' },
  ],
  kotlin: [
    { kind: 'official', title: 'Kotlin documentation', url: 'https://kotlinlang.org/docs/home.html' },
    { kind: 'tutorial', title: 'Kotlin basics', url: 'https://kotlinlang.org/docs/getting-started.html' },
    { kind: 'learning', title: 'Kotlin Koans', url: 'https://kotlinlang.org/docs/koans.html' },
  ],
  ruby: [
    { kind: 'official', title: 'Ruby documentation', url: 'https://www.ruby-lang.org/en/documentation/' },
    { kind: 'learning', title: 'Learn Ruby the Hard Way', url: 'https://learnrubythehardway.org/book/', provider: 'Zed Shaw' },
    { kind: 'learning', title: 'The Odin Project — Ruby', url: 'https://www.theodinproject.com/paths/full-stack-ruby-on-rails', provider: 'The Odin Project' },
  ],
  php: [
    { kind: 'official', title: 'PHP manual', url: 'https://www.php.net/manual/en/' },
    { kind: 'learning', title: 'PHP: The Right Way', url: 'https://phptherightway.com/' },
  ],
  csharp: [
    { kind: 'official', title: 'C# documentation', url: 'https://learn.microsoft.com/en-us/dotnet/csharp/', provider: 'Microsoft Learn' },
    { kind: 'tutorial', title: 'C# tutorials', url: 'https://learn.microsoft.com/en-us/dotnet/csharp/tour-of-csharp/', provider: 'Microsoft Learn' },
  ],
  dotnet: [
    { kind: 'official', title: '.NET documentation', url: 'https://learn.microsoft.com/en-us/dotnet/', provider: 'Microsoft Learn' },
    { kind: 'tutorial', title: 'Get started with .NET', url: 'https://learn.microsoft.com/en-us/dotnet/core/get-started', provider: 'Microsoft Learn' },
  ],
  cpp: [
    { kind: 'official', title: 'cppreference', url: 'https://en.cppreference.com/w/', provider: 'cppreference' },
    { kind: 'learning', title: 'Learn C++', url: 'https://www.learncpp.com/', provider: 'LearnCpp' },
    { kind: 'learning', title: 'C++ Core Guidelines', url: 'https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines', provider: 'isocpp' },
  ],
  c: [
    { kind: 'official', title: 'C reference', url: 'https://en.cppreference.com/w/c', provider: 'cppreference' },
    { kind: 'learning', title: 'Beej’s Guide to C Programming', url: 'https://beej.us/guide/bgc/', provider: 'Beej' },
  ],
  zig: [
    { kind: 'official', title: 'Zig language reference', url: 'https://ziglang.org/documentation/master/' },
    { kind: 'learning', title: 'Ziglings', url: 'https://codeberg.org/ziglings/exercises', provider: 'Ziglings' },
  ],
  elixir: [
    { kind: 'official', title: 'Elixir documentation', url: 'https://hexdocs.pm/elixir/' },
    { kind: 'tutorial', title: 'Getting started', url: 'https://elixir-lang.org/getting-started/introduction.html' },
    { kind: 'learning', title: 'Elixir School', url: 'https://elixirschool.com/en', provider: 'Elixir School' },
  ],
  erlang: [
    { kind: 'official', title: 'Erlang/OTP documentation', url: 'https://www.erlang.org/docs' },
    { kind: 'learning', title: 'Learn You Some Erlang', url: 'https://learnyousomeerlang.com/', provider: 'Fred Hébert' },
  ],
  haskell: [
    { kind: 'official', title: 'Haskell documentation', url: 'https://www.haskell.org/documentation/' },
    { kind: 'learning', title: 'Learn You a Haskell', url: 'http://learnyouahaskell.com/', provider: 'Miran Lipovača' },
  ],
  swift: [
    { kind: 'official', title: 'Swift documentation', url: 'https://www.swift.org/documentation/' },
    { kind: 'tutorial', title: 'The Swift Programming Language', url: 'https://docs.swift.org/swift-book/documentation/the-swift-programming-language/' },
  ],
  scala: [
    { kind: 'official', title: 'Scala documentation', url: 'https://docs.scala-lang.org/' },
    { kind: 'tutorial', title: 'Scala 3 Book', url: 'https://docs.scala-lang.org/scala3/book/introduction.html' },
  ],
  lua: [
    { kind: 'official', title: 'Lua 5.4 reference manual', url: 'https://www.lua.org/manual/5.4/' },
    { kind: 'learning', title: 'Programming in Lua (first edition)', url: 'https://www.lua.org/pil/contents.html' },
  ],
  'r-lang': [
    { kind: 'official', title: 'R manuals', url: 'https://cran.r-project.org/manuals.html' },
    { kind: 'learning', title: 'R for Data Science', url: 'https://r4ds.hadley.nz/', provider: 'Hadley Wickham' },
  ],
  bash: [
    { kind: 'official', title: 'Bash reference manual', url: 'https://www.gnu.org/software/bash/manual/bash.html', provider: 'GNU' },
    { kind: 'learning', title: 'Bash Guide for Beginners', url: 'https://tldp.org/LDP/Bash-Beginners-Guide/html/', provider: 'TLDP' },
    { kind: 'reference', title: 'ShellCheck', url: 'https://www.shellcheck.net/', provider: 'ShellCheck' },
  ],
  powershell: [
    { kind: 'official', title: 'PowerShell documentation', url: 'https://learn.microsoft.com/en-us/powershell/', provider: 'Microsoft Learn' },
  ],
  sql: [
    { kind: 'learning', title: 'SQLBolt interactive lessons', url: 'https://sqlbolt.com/', provider: 'SQLBolt' },
    { kind: 'learning', title: 'Use The Index, Luke', url: 'https://use-the-index-luke.com/', provider: 'Markus Winand' },
  ],

  // --- frontend --------------------------------------------------------------
  react: [
    { kind: 'official', title: 'React documentation', url: 'https://react.dev/reference/react' },
    { kind: 'tutorial', title: 'Learn React', url: 'https://react.dev/learn' },
    { kind: 'learning', title: 'The Odin Project — React', url: 'https://www.theodinproject.com/paths/full-stack-javascript/courses/react', provider: 'The Odin Project' },
  ],
  vue: [
    { kind: 'official', title: 'Vue documentation', url: 'https://vuejs.org/guide/introduction.html' },
    { kind: 'tutorial', title: 'Vue interactive tutorial', url: 'https://vuejs.org/tutorial/' },
  ],
  svelte: [
    { kind: 'official', title: 'Svelte documentation', url: 'https://svelte.dev/docs' },
    { kind: 'tutorial', title: 'Svelte interactive tutorial', url: 'https://svelte.dev/tutorial' },
  ],
  angular: [
    { kind: 'official', title: 'Angular documentation', url: 'https://angular.dev/overview' },
    { kind: 'tutorial', title: 'Angular tutorials', url: 'https://angular.dev/tutorials' },
  ],
  nextjs: [
    { kind: 'official', title: 'Next.js documentation', url: 'https://nextjs.org/docs' },
    { kind: 'tutorial', title: 'Next.js Learn course', url: 'https://nextjs.org/learn' },
  ],
  tailwindcss: [
    { kind: 'official', title: 'Tailwind CSS documentation', url: 'https://tailwindcss.com/docs' },
  ],
  css: [
    { kind: 'official', title: 'MDN CSS reference', url: 'https://developer.mozilla.org/en-US/docs/Web/CSS', provider: 'MDN' },
    { kind: 'learning', title: 'CSS-Tricks Almanac', url: 'https://css-tricks.com/almanac/', provider: 'CSS-Tricks' },
    { kind: 'learning', title: 'Web.dev Learn CSS', url: 'https://web.dev/learn/css', provider: 'web.dev' },
  ],
  html: [
    { kind: 'official', title: 'MDN HTML reference', url: 'https://developer.mozilla.org/en-US/docs/Web/HTML', provider: 'MDN' },
    { kind: 'learning', title: 'Web.dev Learn HTML', url: 'https://web.dev/learn/html', provider: 'web.dev' },
  ],
  'web-platform': [
    { kind: 'official', title: 'MDN Web Docs', url: 'https://developer.mozilla.org/en-US/', provider: 'MDN' },
    { kind: 'learning', title: 'web.dev learn courses', url: 'https://web.dev/learn', provider: 'web.dev' },
    { kind: 'reference', title: 'Can I use', url: 'https://caniuse.com/', provider: 'Can I use' },
  ],
  vite: [
    { kind: 'official', title: 'Vite documentation', url: 'https://vite.dev/guide/' },
  ],
  bun: [
    { kind: 'official', title: 'Bun documentation', url: 'https://bun.sh/docs' },
  ],
  deno: [
    { kind: 'official', title: 'Deno documentation', url: 'https://docs.deno.com/' },
  ],
  nodejs: [
    { kind: 'official', title: 'Node.js API documentation', url: 'https://nodejs.org/docs/latest/api/' },
    { kind: 'learning', title: 'Node.js learn guides', url: 'https://nodejs.org/en/learn' },
  ],
  npm: [
    { kind: 'official', title: 'npm CLI documentation', url: 'https://docs.npmjs.com/' },
  ],

  // --- data ------------------------------------------------------------------
  postgresql: [
    { kind: 'official', title: 'PostgreSQL documentation', url: 'https://www.postgresql.org/docs/current/' },
    { kind: 'tutorial', title: 'PostgreSQL tutorial', url: 'https://www.postgresql.org/docs/current/tutorial.html' },
    { kind: 'learning', title: 'PostgreSQL Exercises', url: 'https://pgexercises.com/', provider: 'pgexercises' },
    { kind: 'learning', title: 'Use The Index, Luke', url: 'https://use-the-index-luke.com/', provider: 'Markus Winand' },
  ],
  mysql: [
    { kind: 'official', title: 'MySQL reference manual', url: 'https://dev.mysql.com/doc/refman/8.4/en/' },
  ],
  sqlite: [
    { kind: 'official', title: 'SQLite documentation', url: 'https://www.sqlite.org/docs.html' },
  ],
  redis: [
    { kind: 'official', title: 'Redis documentation', url: 'https://redis.io/docs/latest/' },
    { kind: 'tutorial', title: 'Redis quick starts', url: 'https://redis.io/docs/latest/develop/get-started/' },
  ],
  mongodb: [
    { kind: 'official', title: 'MongoDB manual', url: 'https://www.mongodb.com/docs/manual/' },
    { kind: 'learning', title: 'MongoDB University', url: 'https://learn.mongodb.com/', provider: 'MongoDB' },
  ],
  clickhouse: [
    { kind: 'official', title: 'ClickHouse documentation', url: 'https://clickhouse.com/docs' },
  ],
  duckdb: [
    { kind: 'official', title: 'DuckDB documentation', url: 'https://duckdb.org/docs/' },
  ],
  elasticsearch: [
    { kind: 'official', title: 'Elasticsearch guide', url: 'https://www.elastic.co/guide/en/elasticsearch/reference/current/index.html' },
  ],
  kafka: [
    { kind: 'official', title: 'Apache Kafka documentation', url: 'https://kafka.apache.org/documentation/' },
    { kind: 'tutorial', title: 'Kafka quickstart', url: 'https://kafka.apache.org/quickstart' },
  ],
  spark: [
    { kind: 'official', title: 'Apache Spark documentation', url: 'https://spark.apache.org/docs/latest/' },
  ],
  supabase: [
    { kind: 'official', title: 'Supabase documentation', url: 'https://supabase.com/docs' },
  ],

  // --- infrastructure --------------------------------------------------------
  kubernetes: [
    { kind: 'official', title: 'Kubernetes documentation', url: 'https://kubernetes.io/docs/home/' },
    { kind: 'tutorial', title: 'Kubernetes tutorials', url: 'https://kubernetes.io/docs/tutorials/' },
    { kind: 'learning', title: 'Kubernetes the Hard Way', url: 'https://github.com/kelseyhightower/kubernetes-the-hard-way', provider: 'Kelsey Hightower' },
    { kind: 'learning', title: 'Killercoda Kubernetes scenarios', url: 'https://killercoda.com/kubernetes', provider: 'Killercoda' },
  ],
  docker: [
    { kind: 'official', title: 'Docker documentation', url: 'https://docs.docker.com/' },
    { kind: 'tutorial', title: 'Docker getting started', url: 'https://docs.docker.com/get-started/' },
  ],
  terraform: [
    { kind: 'official', title: 'Terraform documentation', url: 'https://developer.hashicorp.com/terraform/docs' },
    { kind: 'tutorial', title: 'Terraform tutorials', url: 'https://developer.hashicorp.com/terraform/tutorials' },
  ],
  ansible: [
    { kind: 'official', title: 'Ansible documentation', url: 'https://docs.ansible.com/ansible/latest/' },
  ],
  nginx: [
    { kind: 'official', title: 'nginx documentation', url: 'https://nginx.org/en/docs/' },
  ],
  helm: [
    { kind: 'official', title: 'Helm documentation', url: 'https://helm.sh/docs/' },
  ],
  prometheus: [
    { kind: 'official', title: 'Prometheus documentation', url: 'https://prometheus.io/docs/introduction/overview/' },
  ],
  grafana: [
    { kind: 'official', title: 'Grafana documentation', url: 'https://grafana.com/docs/grafana/latest/' },
  ],
  opentelemetry: [
    { kind: 'official', title: 'OpenTelemetry documentation', url: 'https://opentelemetry.io/docs/' },
  ],
  linux: [
    { kind: 'learning', title: 'The Linux Documentation Project', url: 'https://tldp.org/', provider: 'TLDP' },
    { kind: 'learning', title: 'Linux Journey', url: 'https://linuxjourney.com/', provider: 'Linux Journey' },
    { kind: 'reference', title: 'Linux man pages', url: 'https://man7.org/linux/man-pages/', provider: 'man7' },
  ],
  git: [
    { kind: 'official', title: 'Git reference', url: 'https://git-scm.com/docs' },
    { kind: 'learning', title: 'Pro Git', url: 'https://git-scm.com/book/en/v2', provider: 'Scott Chacon' },
    { kind: 'learning', title: 'Learn Git Branching', url: 'https://learngitbranching.js.org/', provider: 'Learn Git Branching' },
  ],
  'github-actions': [
    { kind: 'official', title: 'GitHub Actions documentation', url: 'https://docs.github.com/en/actions', provider: 'GitHub' },
  ],
  aws: [
    { kind: 'official', title: 'AWS documentation', url: 'https://docs.aws.amazon.com/' },
    { kind: 'learning', title: 'AWS Skill Builder free tier', url: 'https://skillbuilder.aws/', provider: 'AWS' },
  ],
  azure: [
    { kind: 'official', title: 'Azure documentation', url: 'https://learn.microsoft.com/en-us/azure/', provider: 'Microsoft Learn' },
  ],
  'google-cloud': [
    { kind: 'official', title: 'Google Cloud documentation', url: 'https://cloud.google.com/docs' },
  ],
  cloudflare: [
    { kind: 'official', title: 'Cloudflare Developer docs', url: 'https://developers.cloudflare.com/' },
  ],
  vercel: [
    { kind: 'official', title: 'Vercel documentation', url: 'https://vercel.com/docs' },
  ],

  // --- AI --------------------------------------------------------------------
  ai: [
    { kind: 'learning', title: 'fast.ai Practical Deep Learning', url: 'https://course.fast.ai/', provider: 'fast.ai' },
    { kind: 'learning', title: 'Google Machine Learning Crash Course', url: 'https://developers.google.com/machine-learning/crash-course', provider: 'Google' },
    { kind: 'learning', title: 'Dive into Deep Learning', url: 'https://d2l.ai/', provider: 'D2L' },
  ],
  llm: [
    { kind: 'learning', title: 'Hugging Face LLM course', url: 'https://huggingface.co/learn/llm-course', provider: 'Hugging Face' },
    { kind: 'learning', title: 'Neural Networks: Zero to Hero', url: 'https://karpathy.ai/zero-to-hero.html', provider: 'Andrej Karpathy' },
  ],
  pytorch: [
    { kind: 'official', title: 'PyTorch documentation', url: 'https://pytorch.org/docs/stable/index.html' },
    { kind: 'tutorial', title: 'PyTorch tutorials', url: 'https://pytorch.org/tutorials/' },
  ],
  tensorflow: [
    { kind: 'official', title: 'TensorFlow documentation', url: 'https://www.tensorflow.org/api_docs' },
    { kind: 'tutorial', title: 'TensorFlow tutorials', url: 'https://www.tensorflow.org/tutorials' },
  ],
  huggingface: [
    { kind: 'official', title: 'Hugging Face documentation', url: 'https://huggingface.co/docs' },
    { kind: 'learning', title: 'Hugging Face courses', url: 'https://huggingface.co/learn' },
  ],
  langchain: [
    { kind: 'official', title: 'LangChain documentation', url: 'https://python.langchain.com/docs/introduction/' },
  ],
  openai: [
    { kind: 'official', title: 'OpenAI API documentation', url: 'https://platform.openai.com/docs' },
  ],
  anthropic: [
    { kind: 'official', title: 'Claude API documentation', url: 'https://docs.anthropic.com/' },
  ],
  mcp: [
    { kind: 'official', title: 'Model Context Protocol documentation', url: 'https://modelcontextprotocol.io/' },
  ],
  numpy: [
    { kind: 'official', title: 'NumPy documentation', url: 'https://numpy.org/doc/stable/' },
    { kind: 'tutorial', title: 'NumPy absolute beginners guide', url: 'https://numpy.org/doc/stable/user/absolute_beginners.html' },
  ],
  pandas: [
    { kind: 'official', title: 'pandas documentation', url: 'https://pandas.pydata.org/docs/' },
    { kind: 'tutorial', title: '10 minutes to pandas', url: 'https://pandas.pydata.org/docs/user_guide/10min.html' },
  ],

  // --- security & practice ---------------------------------------------------
  security: [
    { kind: 'learning', title: 'OWASP Top Ten', url: 'https://owasp.org/www-project-top-ten/', provider: 'OWASP' },
    { kind: 'learning', title: 'OWASP Cheat Sheet Series', url: 'https://cheatsheetseries.owasp.org/', provider: 'OWASP' },
    { kind: 'learning', title: 'PortSwigger Web Security Academy', url: 'https://portswigger.net/web-security', provider: 'PortSwigger' },
  ],
  cryptography: [
    { kind: 'learning', title: 'Cryptopals challenges', url: 'https://cryptopals.com/', provider: 'Cryptopals' },
    { kind: 'learning', title: 'Crypto 101', url: 'https://www.crypto101.io/', provider: 'Crypto 101' },
  ],
  cve: [
    { kind: 'reference', title: 'CVE Program', url: 'https://www.cve.org/', provider: 'MITRE' },
    { kind: 'reference', title: 'National Vulnerability Database', url: 'https://nvd.nist.gov/', provider: 'NIST' },
  ],
  tls: [
    { kind: 'reference', title: 'Mozilla TLS configuration generator', url: 'https://ssl-config.mozilla.org/', provider: 'Mozilla' },
    { kind: 'learning', title: 'The Illustrated TLS Connection', url: 'https://tls13.xargs.org/', provider: 'xargs.org' },
  ],
  oauth: [
    { kind: 'official', title: 'OAuth 2.0', url: 'https://oauth.net/2/' },
    { kind: 'learning', title: 'OAuth 2.0 Simplified', url: 'https://www.oauth.com/', provider: 'Aaron Parecki' },
  ],
  http: [
    { kind: 'official', title: 'MDN HTTP reference', url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP', provider: 'MDN' },
    { kind: 'learning', title: 'HTTP/3 explained', url: 'https://http3-explained.haxx.se/', provider: 'Daniel Stenberg' },
  ],
  dns: [
    { kind: 'learning', title: 'How DNS works', url: 'https://howdns.works/', provider: 'DNSimple' },
  ],
  architecture: [
    { kind: 'learning', title: 'The System Design Primer', url: 'https://github.com/donnemartin/system-design-primer', provider: 'Donne Martin' },
    { kind: 'learning', title: 'Martin Fowler on architecture', url: 'https://martinfowler.com/architecture/', provider: 'Martin Fowler' },
  ],
  testing: [
    { kind: 'learning', title: 'Testing Library docs', url: 'https://testing-library.com/docs/', provider: 'Testing Library' },
    { kind: 'learning', title: 'Martin Fowler on testing', url: 'https://martinfowler.com/testing/', provider: 'Martin Fowler' },
  ],
  observability: [
    { kind: 'learning', title: 'Google SRE Book', url: 'https://sre.google/sre-book/table-of-contents/', provider: 'Google' },
    { kind: 'official', title: 'OpenTelemetry documentation', url: 'https://opentelemetry.io/docs/' },
  ],
  reliability: [
    { kind: 'learning', title: 'Google SRE Book', url: 'https://sre.google/sre-book/table-of-contents/', provider: 'Google' },
    { kind: 'learning', title: 'The SRE Workbook', url: 'https://sre.google/workbook/table-of-contents/', provider: 'Google' },
  ],
  performance: [
    { kind: 'learning', title: 'Brendan Gregg on systems performance', url: 'https://www.brendangregg.com/', provider: 'Brendan Gregg' },
    { kind: 'learning', title: 'web.dev performance', url: 'https://web.dev/explore/fast', provider: 'web.dev' },
  ],
  devops: [
    { kind: 'learning', title: 'roadmap.sh DevOps roadmap', url: 'https://roadmap.sh/devops', provider: 'roadmap.sh' },
  ],
  frontend: [
    { kind: 'learning', title: 'The Odin Project', url: 'https://www.theodinproject.com/', provider: 'The Odin Project' },
    { kind: 'learning', title: 'Full Stack Open', url: 'https://fullstackopen.com/en/', provider: 'University of Helsinki' },
    { kind: 'learning', title: 'roadmap.sh frontend roadmap', url: 'https://roadmap.sh/frontend', provider: 'roadmap.sh' },
  ],
  backend: [
    { kind: 'learning', title: 'roadmap.sh backend roadmap', url: 'https://roadmap.sh/backend', provider: 'roadmap.sh' },
    { kind: 'learning', title: 'Full Stack Open', url: 'https://fullstackopen.com/en/', provider: 'University of Helsinki' },
  ],
  mobile: [
    { kind: 'learning', title: 'roadmap.sh Android roadmap', url: 'https://roadmap.sh/android', provider: 'roadmap.sh' },
  ],
  android: [
    { kind: 'official', title: 'Android developer documentation', url: 'https://developer.android.com/docs' },
    { kind: 'learning', title: 'Android Basics with Compose', url: 'https://developer.android.com/courses/android-basics-compose/course', provider: 'Google' },
  ],
  ios: [
    { kind: 'official', title: 'Apple Developer documentation', url: 'https://developer.apple.com/documentation/' },
  ],
  gamedev: [
    { kind: 'learning', title: 'Game Programming Patterns', url: 'https://gameprogrammingpatterns.com/', provider: 'Robert Nystrom' },
  ],
  godot: [
    { kind: 'official', title: 'Godot documentation', url: 'https://docs.godotengine.org/en/stable/' },
  ],
  grpc: [
    { kind: 'official', title: 'gRPC documentation', url: 'https://grpc.io/docs/' },
  ],
  graphql: [
    { kind: 'official', title: 'GraphQL documentation', url: 'https://graphql.org/learn/' },
  ],
  websockets: [
    { kind: 'official', title: 'MDN WebSockets API', url: 'https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API', provider: 'MDN' },
  ],
  playwright: [
    { kind: 'official', title: 'Playwright documentation', url: 'https://playwright.dev/docs/intro' },
  ],
  eslint: [
    { kind: 'official', title: 'ESLint documentation', url: 'https://eslint.org/docs/latest/' },
  ],
  webassembly: [
    { kind: 'official', title: 'MDN WebAssembly', url: 'https://developer.mozilla.org/en-US/docs/WebAssembly', provider: 'MDN' },
  ],
};

/**
 * Patterns tried against every stack, and kept only if the URL answers.
 *
 * These are proposals, not facts, and the same shape as vocabulary discovery:
 * propose cheaply, let evidence decide.
 *
 * Two patterns were removed after the first run rather than kept as guesses.
 * Stack Overflow answered 403 to all 81 proposals and Exercism to all 7 -- both
 * block automated requests outright, so their URLs are UNVERIFIABLE rather than
 * wrong. `stackoverflow.com/questions/tagged/c` certainly exists; there is just
 * no way to confirm it from here, and this page does not show links it cannot
 * confirm.
 */
export interface DerivedPattern {
  kind: ResourceSeed['kind'];
  title: (name: string) => string;
  url: (slug: string, stack: { repoUrl: string | null; homepageUrl: string | null; category: string }) => string | null;
  provider: string;
  order: number;
}

export const DERIVED: DerivedPattern[] = [
  {
    kind: 'official',
    provider: 'official',
    order: 10,
    // The topic index brought 730 homepages with it. A project's own site is
    // the first place to send someone, and it is a fact from the source rather
    // than a URL pattern -- but it still gets fetched like everything else.
    title: (name) => `${name} homepage`,
    url: (_slug, s) => s.homepageUrl ?? null,
  },
  {
    kind: 'official',
    provider: 'GitHub',
    order: 200,
    title: (name) => `${name} on GitHub`,
    url: (_slug, s) => s.repoUrl ?? null,
  },
  {
    kind: 'learning',
    provider: 'roadmap.sh',
    order: 220,
    title: (name) => `${name} roadmap`,
    // roadmap.sh publishes no index, but its set of roadmaps is small, stable
    // and public. Guessing at 700 slugs to find eight was 692 wasted requests
    // aimed at one host.
    url: (slug) => (ROADMAPS.has(slug) ? `https://roadmap.sh/${slug}` : null),
  },
];

/**
 * The roadmaps roadmap.sh actually publishes.
 *
 * Every one of these is still verified before it is shown -- the list is here to
 * stop the pass proposing the other 690, not to be trusted on its own.
 */
export const ROADMAPS = new Set([
  'frontend', 'backend', 'devops', 'full-stack', 'ai-engineer', 'data-analyst',
  'ai-data-scientist', 'android', 'ios', 'postgresql-dba', 'blockchain', 'qa',
  'software-architect', 'cyber-security', 'ux-design', 'game-developer',
  'technical-writer', 'devrel', 'product-manager', 'engineering-manager',
  'computer-science', 'react', 'vue', 'angular', 'javascript', 'nodejs',
  'typescript', 'python', 'sql', 'system-design', 'java', 'spring-boot', 'go',
  'rust', 'graphql', 'design-system', 'react-native', 'aws', 'code-review',
  'docker', 'kubernetes', 'linux', 'mongodb', 'prompt-engineering', 'terraform',
  'data-structures-and-algorithms', 'git-github', 'redis', 'php', 'cpp', 'flutter',
  'server-side-game-developer', 'api-design', 'computer-architecture',
]);

/**
 * DevDocs hosts a few hundred documentation sets and publishes the list, so the
 * right question is "which of ours does it have" rather than "does this URL
 * exist" asked seven hundred times.
 */
export const DEVDOCS_INDEX = 'https://devdocs.io/docs/docs.json';
