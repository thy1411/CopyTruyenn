// Hiệu ứng sao băng nền. Chỉ dùng transform/opacity nên rất nhẹ.
// Tạm dừng khi tab bị ẩn; CSS xử lý chế độ "giảm chuyển động".
(() => {
  const fx = document.getElementById("fx");
  if (!fx) return;

  const COUNT = 9;
  const random = (min, max) => min + Math.random() * (max - min);

  for (let i = 0; i < COUNT; i++) {
    const meteor = document.createElement("span");

    meteor.className = "fx-m";
    meteor.style.setProperty("--x", `${random(0, 55).toFixed(0)}%`);
    meteor.style.setProperty("--y", `${random(0, 45).toFixed(0)}%`);
    meteor.style.setProperty("--l", `${random(120, 190).toFixed(0)}px`);
    meteor.style.setProperty("--d", `${random(4, 8).toFixed(1)}s`);
    meteor.style.setProperty("--t", `${(-random(0, 8)).toFixed(1)}s`);

    fx.appendChild(meteor);
  }

  document.addEventListener("visibilitychange", () => {
    document.body.classList.toggle("fx-paused", document.hidden);
  });
})();
