import { useTranslator } from 'src/_functions/translator';
import { useNavigate } from 'react-router-dom';

export default function Home() {
  const translate = useTranslator();
  const navigate = useNavigate();

  return (
    <div className={`w-full h-full bg-background overflow-y-auto`}>
      <div className={`w-full max-w-4xl self-center p-4 md:p-6 flex flex-col gap-4`}>
        <div className={`bg-container1 border border-container1-border rounded-xl p-4 flex flex-col gap-1`}>
          <div className={`text-2xl font-semibold text-title`}>{translate({ key: 'admin.title' })}</div>
          <div className={`text-sm text-common`}>{translate({ key: 'admin.subtitle' })}</div>
        </div>

        <div className={`grid grid-cols-1 md:grid-cols-2 gap-3`}>
          <button
            className={`rounded-xl p-4 bg-container1 border border-container1-border text-left flex flex-col gap-1`}
            onClick={() => {
              void navigate('/admin/camera-access');
            }}
          >
            <div className={`text-lg font-semibold text-title`}>{translate({ key: 'admin.cameraAccessTitle' })}</div>
            <div className={`text-sm text-common`}>{translate({ key: 'admin.cameraAccessDescription' })}</div>
          </button>

          <button
            className={`rounded-xl p-4 bg-container1 border border-container1-border text-left flex flex-col gap-1`}
            onClick={() => {
              void navigate('/cameras');
            }}
          >
            <div className={`text-lg font-semibold text-title`}>{translate({ key: 'admin.cameraMonitorTitle' })}</div>
            <div className={`text-sm text-common`}>{translate({ key: 'admin.cameraMonitorDescription' })}</div>
          </button>
        </div>
      </div>
    </div>
  );
}