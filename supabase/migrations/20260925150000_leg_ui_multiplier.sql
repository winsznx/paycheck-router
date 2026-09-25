-- The Token-2022 Scaled UI multiplier in force when the leg executed (from LegExecuted), as a
-- decimal string, so delivered shares can be shown the way the wallet shows them.
alter table legs add column ui_multiplier text;
