-- The join-request migration (20261026150000) introduced the states 'requested' and 'declined' but the table's CHECK
-- constraint still only allowed 'attending' and 'cancelled', so every "Ask to join" failed with "Could not update that".
alter table public.gathering_rsvps drop constraint if exists gathering_rsvps_status_check;
alter table public.gathering_rsvps
  add constraint gathering_rsvps_status_check check (status in ('requested', 'attending', 'declined', 'cancelled'));
