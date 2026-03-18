const btnBack    = document.getElementById('btn-back');
const btnForward = document.getElementById('btn-forward');
const btnReload  = document.getElementById('btn-reload');
const btnHome    = document.getElementById('btn-home');
const btnExport  = document.getElementById('btn-export');
const spinner    = document.getElementById('spinner');
const progressBar = document.getElementById('progress-bar');

let progressTimer = null;

function startProgress() {
  let pct = 0;
  progressBar.style.width = '0%';
  progressBar.classList.add('loading');

  clearInterval(progressTimer);
  progressTimer = setInterval(() => {
    pct = Math.min(pct + Math.random() * 12, 85);
    progressBar.style.width = pct + '%';
  }, 200);
}

function finishProgress() {
  clearInterval(progressTimer);
  progressBar.style.width = '100%';
  setTimeout(() => {
    progressBar.classList.remove('loading');
    progressBar.style.width = '0%';
  }, 300);
}

btnBack.addEventListener('click',    () => window.api.goBack());
btnForward.addEventListener('click', () => window.api.goForward());
btnHome.addEventListener('click',    () => window.api.goHome());

btnReload.addEventListener('click', () => {
  window.api.reload();
  startProgress();
  spinner.classList.add('visible');
});

window.api.onNavState(({ canGoBack, canGoForward }) => {
  btnBack.disabled    = !canGoBack;
  btnForward.disabled = !canGoForward;
});

btnExport.addEventListener('click', () => {
  window.api.openPrintDialog();
});


window.api.onLoading((isLoading) => {
  if (isLoading) {
    spinner.classList.add('visible');
    startProgress();
  } else {
    spinner.classList.remove('visible');
    finishProgress();
  }
});
