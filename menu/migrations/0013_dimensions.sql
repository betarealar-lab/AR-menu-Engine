-- 0013: width, length and height, not "pick an axis".
--
-- Temo, 2026-09-06: "for size measurement make height width and length as measurement
-- also cause it makes it easier." An owner knows their plate is 28 across and about 3
-- tall; nobody thinks "the width axis is 28 cm". So the request carries all three, any
-- of them optional, and the boxes on the plate are labelled the way a person would say it.
--
-- The engine still bakes ONE dimension and lets the model's own proportions supply the
-- rest (optimize.py). That is deliberate: scaling three axes independently to match three
-- numbers would squash a model whose generated proportions were slightly off, and a
-- slightly-wrong-but-true shape beats an exactly-sized distortion. The other two numbers
-- are kept on the record, so that when the optimiser learns to compare and warn - "the
-- model is 8 cm tall, you said 3" - the data is already there.
--
-- Which of the three is primary is decided HERE, in a trigger, in a fixed order: width,
-- then length, then height. Width is what a phone photograph measures best and what the
-- generator is most consistent about; height is the one it invents most often. A client
-- cannot send an inconsistent pair because it does not send the pair at all.

alter table model_requests add column if not exists width_cm  numeric(6,2)
    check (width_cm  is null or width_cm  between 1 and 200);
alter table model_requests add column if not exists length_cm numeric(6,2)
    check (length_cm is null or length_cm between 1 and 200);
alter table model_requests add column if not exists height_cm numeric(6,2)
    check (height_cm is null or height_cm between 1 and 200);

alter table models add column if not exists width_cm  numeric(6,2);
alter table models add column if not exists length_cm numeric(6,2);
alter table models add column if not exists height_cm numeric(6,2);

comment on column model_requests.width_cm is
    'What the owner said. The primary the engine bakes is derived: width, else length, '
    'else height - into scale_cm/scale_axis by the gate trigger.';

create or replace function model_request_gate()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare
    v_quota integer;
begin
    new.requested_by := auth.uid();
    new.requested_utc := now();

    -- The primary dimension, from the three. Width first: it is what a photo measures
    -- best. Height last: it is what the generator invents most often.
    if new.width_cm is not null then
        new.scale_cm := new.width_cm;  new.scale_axis := 'width';
    elsif new.length_cm is not null then
        new.scale_cm := new.length_cm; new.scale_axis := 'length';
    elsif new.height_cm is not null then
        new.scale_cm := new.height_cm; new.scale_axis := 'height';
    elsif new.scale_cm is null then
        new.scale_axis := null;
    end if;

    if new.kind = 'rescale' then
        new.state := 'approved';
        new.decided_utc := now();
        return new;
    end if;
    select model_quota into v_quota from tenants where id = new.tenant_id;
    if model_requests_used(new.tenant_id) < coalesce(v_quota, 0) then
        new.state := 'approved';
        new.decided_utc := now();
    else
        new.state := 'pending';
        new.note := 'Waiting for us to approve this one.';
    end if;
    return new;
end $fn$;
