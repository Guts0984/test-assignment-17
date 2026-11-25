import { BookingDeskPage } from '@/pages/booking-desk';

const Page = async ({ params }: { params: Promise<{ id: string }> }) => <BookingDeskPage bookingId={(await params).id} />;

export default Page;
