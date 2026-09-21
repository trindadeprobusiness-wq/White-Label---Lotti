import { WhatsAppInbox as Inbox } from '@/features/whatsapp-inbox/WhatsAppInbox';

export default function WhatsAppInbox() {
  return (
    <div className="-mx-5 -mb-16 -mt-20 animate-fade-in md:-mx-8 md:-mt-8" data-layout="full-inbox">
      <Inbox />
    </div>
  );
}
