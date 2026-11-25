import { GuestManagePage } from '@/pages/guest-manage';

const Page = async ({ params }: { params: Promise<{ token: string }> }) => <GuestManagePage token={(await params).token} />;

export default Page;
