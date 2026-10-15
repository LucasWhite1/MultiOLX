// Real Electron DOM fixture; every request stays inside the temporary test sessions.
function batchFixture(url) {
  const page = new URL(url);
  if (page.hostname === 'conta.olx.com.br')
    return '<h1>Meus anúncios</h1><p>Você ainda não tem anúncios</p>';
  if (page.hostname === 'olx-pay.olx.com.br')
    return `<h1>Evoluímos o jeito de vender</h1><button onclick="delivery()">Continuar</button><script>
  function delivery(){document.body.innerHTML='<h1>Envie com segurança pela OLX</h1><input type="checkbox" aria-label="Entrega pela OLX" checked><button onclick="survey()">Continuar</button>';}
  function survey(){if(document.querySelector('input').checked)throw Error('Entrega não desmarcada');const modal=document.createElement('div');modal.setAttribute('role','dialog');modal.dataset.state='open';modal.style.opacity='0';modal.innerHTML='<h2>Por que você não deseja fazer a entrega pela OLX?</h2><label for="reason">Tenho outros motivos.</label><input id="reason" type="radio"><button onclick="finish()">Continuar</button>';document.body.append(modal);}
  function finish(){if(!document.getElementById('reason').checked)throw Error('Motivo não selecionado');location.href='https://adquirir.olx.com.br/destaques?shipping=off';}
  </script>`;
  if (page.hostname === 'adquirir.olx.com.br') {
    if (page.searchParams.has('done')) return '<h1>Anúncio enviado com sucesso!</h1>';
    return `<label><input type="radio" name="offer" aria-label="NO_PRODUCT">Anunciar sem destacar</label><label><input type="radio" name="offer" aria-label="PACKAGE_GOLD" checked>Destaque pago</label><button onclick="if(document.querySelector('[aria-label=NO_PRODUCT]').checked&&!document.querySelector('[aria-label=PACKAGE_GOLD]').checked)location.search+='&done=1'">Finalizar anúncio</button>`;
  }
  return `<input id="subject"><textarea id="body"></textarea><input id="price"><input id="zipcode"><input type="file" accept="image/*" multiple><button onclick="if(document.getElementById('subject').value&&document.getElementById('body').value&&document.querySelector('[type=file]').files.length)location.href='https://olx-pay.olx.com.br/aderir'">Continuar</button>`;
}
module.exports = { batchFixture };
