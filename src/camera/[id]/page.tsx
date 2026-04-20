import CameraMonitorPage, { template } from 'src/cameras/page';

interface PageProps {
  params?: Record<string, string | undefined>;
  searchParams?: Record<string, string | undefined>;
}

export { template };

export default function CameraByIdPage({ params, searchParams }: PageProps) {
  return <CameraMonitorPage params={params} searchParams={searchParams} />;
}
