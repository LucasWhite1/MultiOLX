// Synthetic public DOM matching the stages observed on 15/10/2026. No OLX requests.
function listingWizardFixture(url) {
  const page = new URL(url);
  if (page.hostname === 'olx-pay.olx.com.br')
    return `<h1>Confirme seus dados</h1><input id="name"><input id="birthdate.day"><button id="manual" onclick="location.href='https://adquirir.olx.com.br/destaques'">Continuar</button>`;
  if (page.hostname === 'adquirir.olx.com.br')
    return `<label><input type="radio" name="offer" aria-label="NO_PRODUCT" style="display:none">Anunciar sem destacar</label><label><input type="radio" name="offer" aria-label="PACKAGE_GOLD" checked>Destaque Ouro</label><button onclick="document.body.innerHTML='<h1>Anúncio enviado com sucesso!</h1>'">Finalizar anúncio</button>`;
  return `<h1>Publicação de teste local</h1><div class="category-steps-navigation"><div class="progress-stepped"><div role="progressbar" aria-valuenow="30" aria-valuemin="0" aria-valuemax="100" data-state="loading"></div></div></div><img src="data:image/png;base64,broken" alt="Publicidade irrelevante"><div style="visibility:hidden"><button onclick="throw Error('Controle oculto acionado')">Continuar</button></div><div id="step"><input id="subject"><button onclick="photos()">Continuar</button></div><script>
  const box=document.getElementById('step');
  function save(id){sessionStorage.setItem(id,document.getElementById(id).value);}
  function photos(){save('subject');box.innerHTML='<input type="file" id="lastStepImageInput" accept=".jpg, .jpeg, .gif, .png, .heic, .webp" multiple style="display:none"><div id="progress" role="progressbar"></div><button disabled onclick="ai()">Continuar</button>';document.getElementById('lastStepImageInput').onchange=()=>{sessionStorage.setItem('photos',document.getElementById('lastStepImageInput').files.length);setTimeout(()=>{document.getElementById('progress').remove();box.querySelector('button').disabled=false;},1300);};}
  let photoClicks=0;
  function ai(){if(++photoClicks===1)return;box.innerHTML='Preparando o seu anúncio com inteligência artificial';setTimeout(()=>{box.innerHTML='<p>Celulares e Smartphones</p><div id="electronics_brand" role="combobox" tabindex="0">Marca</div><button onclick="details()">Continuar</button>';},600);}
  function details(){box.innerHTML='<textarea id="body">Texto gerado pela OLX</textarea><input id="zipcode"><button onclick="price()">Continuar</button>';}
  function price(){save('body');save('zipcode');box.innerHTML='<input id="price"><button onclick="finish()">Continuar</button>';}
  function finish(){save('price');location.href='https://olx-pay.olx.com.br/aderir';}
  </script>`;
}
module.exports = { listingWizardFixture };
