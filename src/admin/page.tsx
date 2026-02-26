import { useTranslator } from 'src/_functions/translator';

export default function Home() {
  const translate = useTranslator();
  return (
    <div className='flex items-center justify-center text-4xl font-semibold w-full h-full'>
      {translate({ key: 'admin.title' })}
    </div>
  )
}