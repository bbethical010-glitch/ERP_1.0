import { useEffect } from 'react';

function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

export function useGlobalShortcuts(handlers) {
  useEffect(() => {
    function onKeyDown(event) {
      if (handlers.disabled) return;
      if (event.defaultPrevented) return;
      const typing = isTypingTarget(event.target);
      const key = event.key.toLowerCase();

      const gotoPressed = (event.metaKey || event.ctrlKey) && key === 'k';
      if (gotoPressed && handlers.onGoTo) {
        event.preventDefault();
        handlers.onGoTo();
        return;
      }

      const createPressed = !typing && event.altKey && key === 'c';
      if (createPressed && handlers.onCreate) {
        event.preventDefault();
        handlers.onCreate();
        return;
      }

      const createQuickPressed = !typing && event.altKey && key === 'n';
      if (createQuickPressed && handlers.onCreate) {
        event.preventDefault();
        handlers.onCreate();
        return;
      }

      const usersPressed = !typing && event.altKey && key === 'u';
      if (usersPressed && handlers.onUsers) {
        event.preventDefault();
        handlers.onUsers();
        return;
      }

      const passwordPressed = !typing && event.altKey && key === 'p';
      if (passwordPressed && handlers.onPassword) {
        event.preventDefault();
        handlers.onPassword();
        return;
      }

      const gatewayPressed = !typing && event.altKey && key === 'g';
      if (gatewayPressed && handlers.onGateway) {
        event.preventDefault();
        handlers.onGateway();
        return;
      }

      const mastersPressed = !typing && event.altKey && key === 'm';
      if (mastersPressed && handlers.onMasters) {
        event.preventDefault();
        handlers.onMasters();
        return;
      }

      const transactionsPressed = !typing && event.altKey && key === 't';
      if (transactionsPressed && handlers.onTransactions) {
        event.preventDefault();
        handlers.onTransactions();
        return;
      }

      if (!typing && event.key === 'Escape' && handlers.onBack) {
        event.preventDefault();
        handlers.onBack();
        return;
      }

      const savePressed = ((event.metaKey || event.ctrlKey) && key === 's') || (!typing && event.altKey && key === 's');
      if (savePressed && handlers.onSave) {
        event.preventDefault();
        handlers.onSave();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [handlers]);
}
