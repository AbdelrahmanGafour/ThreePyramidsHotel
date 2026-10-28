ALTER TABLE notification_outbox DROP CHECK notification_outbox_event_type_check
-- ;;
ALTER TABLE notification_outbox ADD CONSTRAINT notification_outbox_event_type_check CHECK (event_type IN ('room_reservation_created', 'room_reservation_confirmed', 'package_reservation_created', 'package_reservation_confirmed', 'contact_inquiry_received'))
