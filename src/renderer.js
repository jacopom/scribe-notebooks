document.addEventListener('DOMContentLoaded', () => {
  const webview = document.querySelector('webview');

  webview.addEventListener('dom-ready', () => {
    // Handle webview ready state
  });

  webview.addEventListener('did-fail-load', (event) => {
    console.error('Failed to load:', event.errorDescription);
  });
}); 