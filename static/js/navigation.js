/* Shared navigation; the server decides whether a room-wide exit is permitted. */
(function () {
  const logo = document.getElementById('aircraft-logo');
  const dialog = document.getElementById('exit-confirm');
  let pending = false;
  function returnHome() { location.assign('/'); }
  window.ScrambleNavigation = {
    reset() { pending = false; },
    lobby() {
      if (pending) return;
      if (window.scrambleActive?.()) {
        if (dialog?.showModal) dialog.showModal();
        else if (window.confirm('Return to lobby? Your current match will end.')) this.confirm();
        return;
      }
      // Merely visiting the home screen must not terminate an existing room.
      if (window.scrambleInRoom?.()) { returnHome(); return; }
      returnHome();
    },
    confirm() {
      if (pending) return;
      pending = true;
      dialog?.close();
      if (typeof window.scrambleReturn === 'function') window.scrambleReturn();
      else returnHome();
    },
    cancel() { dialog?.close(); pending = false; }
  };
  logo?.addEventListener('click', e => { e.preventDefault(); window.ScrambleNavigation.lobby(); });
  document.querySelectorAll('[data-lobby]').forEach(el => el.addEventListener('click', e => {
    e.preventDefault(); window.ScrambleNavigation.lobby();
  }));
  document.getElementById('confirm-exit')?.addEventListener('click', () => window.ScrambleNavigation.confirm());
  document.getElementById('cancel-exit')?.addEventListener('click', () => window.ScrambleNavigation.cancel());
  dialog?.addEventListener('cancel', () => window.ScrambleNavigation.cancel());
})();
