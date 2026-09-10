-- 0022: let the engine say it is alive.
--
-- On 2026-09-10 a model request sat at `approved` for as long as anybody cared to wait.
-- The bridge had exited during a network blip and nothing restarted it; two idle workers
-- sat beside the request; and there was no way to find that out except to open a terminal
-- on the machine the engine runs on. The owner saw "queued" and Temo had to ask.
--
-- `deploy/keepalive.py` now supervises both processes and writes here every 20 seconds.
-- One row, overwritten - this is a liveness signal, not a log. If the row is fresh the
-- engine is up; if it is minutes old, it is not, and the developer screen says so in
-- words instead of leaving a request that never moves.
--
-- **Written with the service key, by the engine.** Not by anybody's browser: the engine
-- is the only thing that knows whether the engine is running, and a client that could
-- write here could claim the engine was healthy.

create table if not exists engine_heartbeat (
    -- One row, always 'engine'. A primary key with one legal value is how "there is
    -- exactly one of these" is said in SQL.
    id        text        primary key,
    seen_utc  timestamptz not null default now(),
    host      text        not null default '',
    -- Human-readable: "worker up, bridge up (2 restarts)". Read straight onto the screen.
    detail    text        not null default ''
);

comment on table engine_heartbeat is
    'Liveness for the local engine (worker + bridge), written every 20s by '
    'deploy/keepalive.py with the service key. One row. Fresh means up; stale means the '
    'engine is not running and model requests will sit at `approved` forever.';

alter table engine_heartbeat enable row level security;

drop policy if exists engine_heartbeat_read on engine_heartbeat;

-- Super admins only. An owner cannot act on this and should not be shown our plumbing;
-- what they get is the "taking longer than it should" line on their own request.
create policy engine_heartbeat_read on engine_heartbeat for select
    using (is_super_admin());

grant select on engine_heartbeat to authenticated;

-- No insert/update/delete grant on purpose: the engine writes with the service key, which
-- bypasses RLS. Nothing that runs in a browser can claim the engine is alive.
