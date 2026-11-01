import { EventDetailPage } from "@/features/event-detail";
export const metadata = { title: "Event evidence" };
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EventDetailPage key={id} id={id} />;
}
