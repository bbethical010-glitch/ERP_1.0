import { useEffect } from 'react';

function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

export function useGlobalShortcuts(handlers) {
  useEffect(() => {
    function onKeyDown(event) {
      if (event.defaultPrevented) return;
      const typing = isTypingTarget(event.target);
      const key = event.key.toLowerCase();
      const createPressed = !typing && event.altKey && key === 'c';
      if (createPressed && handlers.onCreate) {
        event.preventDefault();
        handlers.onCreate();
      }

      const usersPressed = !typing && event.altKey && key === 'u';
      if (usersPressed && handlers.onUsers) {
        event.preventDefault();
        handlers.onUsers();
      }

      const passwordPressed = !typing && event.altKey && key === 'p';
      if (passwordPressed && handlers.onPassword) {
        event.preventDefault();
        handlers.onPassword();
      }

      if (!typing && event.key === 'Escape' && handlers.onBack) {
        event.preventDefault();
        handlers.onBack();
      }

      const savePressed = !typing && event.key === 'Enter';
      if (savePressed && handlers.onSave) {
        event.preventDefault();
        handlers.onSave();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [handlers]);
}
