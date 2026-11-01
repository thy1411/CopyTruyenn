// Mở giao diện tiện ích khi người dùng nhấn vào biểu tượng.
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({
    url: chrome.runtime.getURL("app.html")
  });
});
