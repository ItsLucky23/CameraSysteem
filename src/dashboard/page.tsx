import { useTranslator } from 'src/_functions/translator';

export default function DashboardPage() {
  const translate = useTranslator();
  return (
    <div>
      <h1>{translate({ key: 'dashboard.title' })}</h1>
    </div>
  );
}