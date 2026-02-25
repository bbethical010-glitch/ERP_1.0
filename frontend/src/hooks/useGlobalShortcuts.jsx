import { useEffect } from 'react';

function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || target.isContentEditable;
}

export function useGlobalShortcuts(handlers) {
  useEffect(() => {
    function onKeyDown(event) {
      if (event.altKey && event.key.toLowerCase() === 'c' && handlers.onCreate) {
        event.preventDefault();
        handlers.onCreate();
      }

      if (event.key === 'Escape' && handlers.onBack) {
        event.preventDefault();
        handlers.onBack();
      }

      if (event.key === 'Enter' && handlers.onSave && !isTypingTarget(event.target)) {
        event.preventDefault();
        handlers.onSave();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [handlers]);
}
