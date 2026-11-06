// Icon click / Alt+Shift+E injects content.js, which toggles the editor on that tab (activeTab only).
async function setBadge(tabId, on) {
  await chrome.action.setBadgeText({ tabId, text: on ? 'ON' : '' });
  if (on) await chrome.action.setBadgeBackgroundColor({ tabId, color: '#3b5bdb' });
}

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id == null) return;
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    await setBadge(tab.id, !!res?.result);
  } catch {
    // chrome://, Web Store, PDF viewer etc. cannot be edited
    await chrome.action.setBadgeText({ tabId: tab.id, text: '!' });
    await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#c0392b' });
    setTimeout(() => chrome.action.setBadgeText({ tabId: tab.id, text: '' }).catch(() => {}), 2000);
  }
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === 'PE_STATE' && sender.tab?.id != null) setBadge(sender.tab.id, msg.on);
});
