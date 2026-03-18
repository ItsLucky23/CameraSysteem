/* eslint-disable react-refresh/only-export-components -- tells linting to not get upset for exporting a non react hook in this file */
import { ReactNode, useState } from 'react';

import { menuHandler } from 'src/_functions/menuHandler';
import { useTranslator } from 'src/_functions/translator';

interface ConfirmMenuProps {
  title: string;
  content?: string | ReactNode;
  input?: string;
  resolve: (val: boolean) => void;
}

export function ConfirmMenu({ title, content, input, resolve }: ConfirmMenuProps) {
  const translate = useTranslator();
  const [inputValue, setInputValue] = useState('');

  const handleConfirm = () => {
    if (input && input !== inputValue) return;
    resolve(true);
    menuHandler.close();
  };

  const handleCancel = () => {
    resolve(false);
    menuHandler.close();
  };

  const inputRequiredAndInvalid = input && input !== inputValue ? true : false;

  return (
    <form
      className="p-6 flex flex-col gap-4 bg-container1 w-full max-w-md"
      data-menuhandler-submit-on-enter="true"
      onSubmit={(event) => {
        event.preventDefault();
        handleConfirm();
      }}
    >
      <h2 className="text-xl font-bold">{title}</h2>

      {typeof content === 'string' ? (
        <p className="text-common">{content}</p>
      ) : (
        content
      )}

      {input && (
        <div className="flex flex-col gap-1">
          <label className="text-sm text-common/80">
            {translate({ key: 'confirm.type' })} <span className="font-mono bg-container2 px-1">{input}</span> {translate({ key: 'confirm.toConfirm' })}
          </label>
          <input
            type="text"
            className="border border-container1-border rounded px-2 py-1 focus:border-primary outline-none focus:ring-0 bg-container1 text-title"
            value={inputValue}
            onChange={(e) => { setInputValue(e.target.value); }}
          />
        </div>
      )}

      <div className="flex gap-4 justify-end">
        <button
          type="button"
          onClick={handleCancel}
          className="px-4 py-2 rounded bg-container2 hover:bg-container2-hover text-common text-sm font-semibold border border-container2-border"
        >
          {translate({ key: 'confirm.cancel' })}
        </button>
        <button
          type="submit"
          disabled={inputRequiredAndInvalid}
          className={`px-4 py-2 rounded text-sm text-white transition font-semibold
            ${inputRequiredAndInvalid
              ? 'bg-primary/50 cursor-not-allowed'
              : 'bg-primary hover:bg-primary-hover cursor-pointer'
            }`}
        >
          {translate({ key: 'confirm.confirm' })}
        </button>
      </div>
    </form>
  );
}

export function confirmDialog(props: Omit<ConfirmMenuProps, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    void menuHandler.open(
      <ConfirmMenu {...props} resolve={resolve} />,
      { dimBackground: true, background: 'bg-container1', size: 'sm' }
    );
  });
}
