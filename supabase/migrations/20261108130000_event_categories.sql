-- Events: six proper categories (Social & Drinks, Games & Hobbies, Outdoor & Adventure, Music & Nightlife, Food & Dining,
-- Fitness & Wellness). The old values stay allowed so nothing already stored breaks; existing events are moved across.
alter table public.gatherings drop constraint if exists gatherings_category_check;
alter table public.gatherings add constraint gatherings_category_check check (
  category = any (array['social','games','outdoor','music','food','fitness','arts','active','discussions','nightlife']::text[]));

update public.gatherings set category = case category
  when 'active' then 'outdoor'
  when 'nightlife' then 'music'
  when 'arts' then 'games'
  when 'discussions' then 'social'
  else category end
where category in ('active','nightlife','arts','discussions');
