document.getElementById("btn").addEventListener("click", getVideo);

async function getVideo() {

  const url = document.getElementById("url").value;

  const res = await fetch(
    "/video-info?url=" + encodeURIComponent(url)
  );

  const data = await res.json();

  document.getElementById("result").innerHTML = `
    <h2>${data.title}</h2>
    <p>Channel: ${data.channel}</p>
    <p>Views: ${data.views}</p>
    <img src="${data.thumbnail}" width="300">
  `;
}
