import { useEffect, useState } from 'react';
import { Link } from "react-router-dom";

import { useSession } from "src/_providers/SessionProvider";
import { apiRequest } from "src/_sockets/apiRequest";
import { joinRoom } from "src/_sockets/socketInitializer";
import { syncRequest, useSyncEvents } from "src/_sockets/syncRequest";
import { useTranslator } from "src/_functions/translator";

export const template = 'home';

export default function ExamplesPage() {
  const { session } = useSession();
  const translate = useTranslator();
  const btnMinus = "−";
  const btnPlus = "+";
  const [counter, setCounter] = useState(0);
  const [apiResults, setApiResults] = useState<{ APINAME: string; result: unknown; ts: string }[]>([]);

  useEffect(() => {
    void joinRoom('examples-room');
  }, []);

  const { upsertSyncEventCallback } = useSyncEvents();

  useEffect(() => {
    return upsertSyncEventCallback({
      name: 'examples/updateCounter',
      version: 'v1',
      callback: ({ serverOutput, clientOutput }) => {
        console.log(clientOutput)
        setCounter(prev => serverOutput.increase ? prev + 1 : prev - 1);
      }
    });
  }, [upsertSyncEventCallback]);

  const logResult = (APINAME: string, result: unknown) => {
    setApiResults(prev => [{ APINAME, result, ts: new Date().toISOString() }, ...prev.slice(0, 4)]);
  };

  return (
    <div className="w-full h-full bg-background overflow-y-auto">
      <div className="max-w-6xl mx-auto p-6 flex flex-col gap-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-bold text-title">{translate({ key: 'examples.title' })}</h1>
            <p className="text-muted text-sm">{translate({ key: 'examples.subtitle' })}</p>
          </div>
          <Link to="/docs" className="px-4 h-9 bg-container1 border border-container1-border text-commen rounded-md flex items-center justify-center hover:scale-105 transition-all duration-300">
            {translate({ key: 'examples.docs' })}
          </Link>
        </div>

        {/* Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4 auto-rows-auto">

          {/* User Info - Tall */}
          <div className="md:row-span-2 bg-container1 border border-container1-border rounded-lg p-5 flex flex-col gap-4">
            <h2 className="font-semibold text-title flex items-center gap-2">
              <span className="w-6 h-6 bg-primary rounded flex items-center justify-center text-white text-xs"></span>
              {translate({ key: 'examples.userInfo' })}
            </h2>
            {session?.id ? (
              <div className="flex flex-col gap-3 flex-1">
                <div className="w-16 h-16 bg-container12 border border-container2-border rounded-full flex items-center justify-center text-title text-2xl font-bold">
                  {session.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex flex-col gap-1">
                  <p className="text-title font-medium">{session.name}</p>
                  <p className="text-xs text-muted">{session.email}</p>
                  <p className={`text-xs mt-2 px-2 py-1 rounded inline-block w-fit ${session.admin ? 'bg-correct text-white' : 'bg-container12 text-muted'}`}>
                    {session.admin ? '✓ Admin' : 'Not Admin'}
                  </p>
                </div>
                <button
                  onClick={() => void apiRequest({ name: 'logout', version: 'v1' }) }
                  className="mt-auto px-4 h-9 bg-container12 border border-container2-border text-commen rounded-md hover:bg-container12-hover transition-colors text-sm"
                >
                  {translate({ key: 'examples.logout' })}
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3 flex-1 items-center justify-center">
                <p className="text-muted text-sm">{translate({ key: 'examples.notLoggedIn' })}</p>
                <Link to="/login" className="px-4 h-9 bg-primary text-white rounded-md flex items-center justify-center hover:scale-105 transition-all duration-300 text-sm">
                  {translate({ key: 'examples.goToLogin' })}
                </Link>
              </div>
            )}
          </div>

          {/* Real-time Sync - Wide */}
          <div className="md:col-span-2 lg:col-span-3 bg-container1 border border-container1-border rounded-lg p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-title flex items-center gap-2">
                <span className="w-6 h-6 bg-orange-500 rounded flex items-center justify-center text-white text-xs"></span>
                {translate({ key: 'examples.realTimeSync' })}
              </h2>
              <span className="text-xs text-muted">{translate({ key: 'examples.openTabs' })}</span>
            </div>
            <div className="flex items-center gap-6 justify-center py-4">
              <button
                onClick={() => { void syncRequest({ name: 'examples/updateCounter', version: 'v1', data: { increase: false }, receiver: 'examples-room' }); }}
                className="w-14 h-14 bg-wrong text-white rounded-full text-3xl font-bold hover:scale-110 transition-transform cursor-pointer"
              >{btnMinus}</button>
              <div className="w-28 h-20 bg-container12 border border-container2-border rounded-lg flex items-center justify-center">
                <span className="text-4xl font-bold text-title">{counter}</span>
              </div>
              <button
                onClick={() => { void syncRequest({ name: 'examples/updateCounter', version: 'v1', data: { increase: true }, receiver: 'examples-room' }); }}
                className="w-14 h-14 bg-correct text-white rounded-full text-3xl font-bold hover:scale-110 transition-transform cursor-pointer"
              >{btnPlus}</button>
            </div>
          </div>

          {/* Public API */}
          <div className="bg-container1 border border-container1-border rounded-lg p-5 flex flex-col gap-3">
            <h3 className="font-semibold text-title text-sm">{translate({ key: 'examples.publicApi' })}</h3>
            <p className="text-xs text-muted">{translate({ key: 'examples.noLoginNeeded' })}</p>
            <button
              onClick={() => {
                void (async () => {
                  const result = await apiRequest({ name: "examples/publicApi", version: 'v1', data: { message: "Message sent from the client!" } })
                  logResult('publicApi', result)
                })();
              }}
              className="mt-auto px-4 h-9 bg-correct text-white rounded-md hover:bg-correct-hover transition-colors text-sm cursor-pointer"
            >
              {translate({ key: 'examples.callApi' })}
            </button>
          </div>

          {/* Toggle Admin */}
          <div className="bg-container1 border border-container1-border rounded-lg p-5 flex flex-col gap-3">
            <h3 className="font-semibold text-title text-sm">{translate({ key: 'examples.toggleAdmin' })}</h3>
            <p className="text-xs text-muted">{translate({ key: 'examples.requiresLogin' })}</p>
            <button
              onClick={() => {
                void (async () => {
                  const result = await apiRequest({ name: "examples/toggleAdmin", version: 'v1' })
                  logResult('toggleAdmin', result)
                })();
              }}
              className="mt-auto px-4 h-9 bg-orange-500 text-white rounded-md hover:bg-orange-600 transition-colors text-sm cursor-pointer"
            >
              {translate({ key: 'examples.toggle' })}
            </button>
          </div>

          {/* Admin Only */}
          <div className="bg-container1 border border-container1-border rounded-lg p-5 flex flex-col gap-3">
            <h3 className="font-semibold text-title text-sm">{translate({ key: 'examples.adminOnly' })}</h3>
            <p className="text-xs text-muted">{translate({ key: 'examples.adminTrueRequired' })}</p>
            <button
              onClick={() => {
                void (async () => {
                  const result = await apiRequest({ name: 'examples/adminOnly', version: 'v1' })
                  logResult('adminOnly', result)
                })();
              }}
              className="mt-auto px-4 h-9 bg-wrong text-white rounded-md hover:bg-wrong-hover transition-colors text-sm cursor-pointer"
            >
              {translate({ key: 'examples.callApi' })}
            </button>
          </div>

          {/* API Results - Full Width */}
          <div className="md:col-span-3 lg:col-span-4 bg-container1 border border-container1-border rounded-lg p-5 flex flex-col gap-3">
            <h3 className="font-semibold text-title text-sm">{translate({ key: 'examples.apiResults' })}</h3>
            {apiResults.length === 0 ? (
              <p className="text-xs text-muted">{translate({ key: 'examples.apiResultsDesc' })}</p>
            ) : (
              <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
                {apiResults.map((item) => (
                  <div key={`${item.APINAME}-${item.ts}`} className="flex gap-3 text-xs p-2 bg-container12 border border-container2-border rounded">
                    <span className="font-mono text-primary w-32 flex-shrink-0">{item.APINAME}</span>
                    <span className="text-muted">{item.ts}</span>
                    <pre className="text-commen flex-1 overflow-x-auto">{JSON.stringify(item.result, null, 0)}</pre>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}