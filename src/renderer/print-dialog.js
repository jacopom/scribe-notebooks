let totalPages = 1;

async function init() {
  const info = await window.printApi.getInfo();
  totalPages = info.totalPages;
  const currentPage = info.currentPageIndex + 1; // 1-based

  document.getElementById('subtitle').textContent = `"${info.notebookTitle}"`;
  document.getElementById('page-count').textContent = totalPages;
  document.getElementById('current-page').textContent = currentPage;

  const rangeFrom = document.getElementById('range-from');
  const rangeTo   = document.getElementById('range-to');
  rangeFrom.max = totalPages;
  rangeTo.max   = totalPages;
  rangeTo.value = totalPages;
}

document.querySelectorAll('input[name="pages"]').forEach(radio => {
  radio.addEventListener('change', () => {
    const isRange = document.getElementById('pages-range').checked;
    document.getElementById('range-from').disabled = !isRange;
    document.getElementById('range-to').disabled   = !isRange;
  });
});

document.getElementById('btn-cancel').addEventListener('click', () => {
  window.printApi.cancel();
});

document.getElementById('btn-save').addEventListener('click', async () => {
  const format     = document.querySelector('input[name="format"]:checked').value;
  const pagesValue = document.querySelector('input[name="pages"]:checked').value;

  let pages;
  if (pagesValue === 'range') {
    const from = parseInt(document.getElementById('range-from').value, 10);
    const to   = parseInt(document.getElementById('range-to').value,   10);
    pages = { from: Math.max(1, from), to: Math.min(totalPages, Math.max(from, to)) };
  } else {
    pages = pagesValue;
  }

  const btn = document.getElementById('btn-save');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  await window.printApi.execute({ format, pages });
});

init();
