-- 0038: does the link actually go anywhere.
--
-- The registry's whole point, once you stop reading it as a list of names, is
-- the URL: where a stack's site is, where a tool is bought, where a platform is
-- deployed. That column has never been checked, and a spot check says why it
-- needs to be -- `argocd` records its homepage as argo.ucsd.edu, which is a
-- physics group at UC San Diego. It was derived from a URL pattern, it looks
-- entirely plausible, and it is wrong.
--
-- A dead or wrong link is worse than a missing one. A blank tells the reader
-- there is nothing recorded; a wrong one costs a click, a page load, and the
-- moment of confusion before they realise it is not what they asked for. So
-- results are stored, and the registry shows the checked state next to the link
-- rather than presenting all of them as equally good.
--
-- Keyed by URL, not by stack. Three tables reference the same addresses --
-- stacks.homepage_url, stacks.repo_url, platforms.url, stack_resources.url --
-- and github.com/x/y appears under several stacks at once. One row per address
-- checks each one once, and every table can read the same answer.

CREATE TABLE IF NOT EXISTS link_checks (
  url         text PRIMARY KEY,
  -- HTTP status, or NULL when the host never answered at all: DNS failure, TLS
  -- failure, timeout. Those are a different kind of dead from a 404 and the
  -- registry says so differently.
  status      int,
  -- Where it ended up. A homepage that 301s to a domain-parking page is dead in
  -- every sense that matters while returning a cheerful 200, and the only
  -- evidence is that the final URL is nothing like the one recorded.
  final_url   text,
  error       text,
  duration_ms int,
  checked_at  timestamptz NOT NULL DEFAULT now()
);

-- The checker asks "what has not been looked at, or was looked at long ago",
-- and the registry asks "is this one alive". Both are covered by the primary
-- key plus this.
CREATE INDEX IF NOT EXISTS link_checks_checked_idx ON link_checks (checked_at);

GRANT SELECT ON link_checks TO newstrack_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON link_checks TO newstrack_worker;

-- A link is good if it answered 2xx. 3xx that never resolved, 4xx and 5xx are
-- all "do not put this in front of someone as the place to go", and NULL means
-- nobody has looked yet -- which the registry must not confuse with working.
CREATE OR REPLACE VIEW link_health AS
SELECT url,
       status,
       final_url,
       checked_at,
       CASE
         WHEN status BETWEEN 200 AND 299 THEN 'ok'
         WHEN status IS NULL             THEN 'unreachable'
         WHEN status IN (401, 403)       THEN 'blocked'
         WHEN status = 404               THEN 'missing'
         WHEN status BETWEEN 500 AND 599 THEN 'erroring'
         ELSE 'odd'
       END AS state,
       -- Redirected somewhere with a different registrable-looking host. Not
       -- proof of anything on its own -- example.org -> www.example.org is
       -- normal -- so it is surfaced as a flag for a person, not acted on.
       (final_url IS NOT NULL
        AND split_part(split_part(final_url, '://', 2), '/', 1)
            <> split_part(split_part(url, '://', 2), '/', 1)) AS moved
  FROM link_checks;

GRANT SELECT ON link_health TO newstrack_app, newstrack_worker;
