import { GuestBookingPage } from '@/pages/guest-booking';

const Page = async ({ params }: { params: Promise<{ token: string }> }) => <GuestBookingPage token={(await params).token} />;

export default Page;
