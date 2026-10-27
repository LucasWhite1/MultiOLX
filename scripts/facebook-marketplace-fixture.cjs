function facebookMarketplaceFixture(url = 'https://www.facebook.com/marketplace/inbox/') {
  const id = /^\/messages\/t\/(\d+)\/?$/.exec(new URL(url).pathname)?.[1];
  if (id)
    return `<main role="main"><h1>${id === '123' ? 'Cliente · Produto real' : 'Outro · Outro produto'}</h1><span>Marketplace</span><div aria-label="Mensagens">Histórico da conversa ${id}</div><div contenteditable="true" role="textbox" aria-label="Mensagem"></div></main>`;
  return `<style>a,[role=button]{display:block;padding:6px}</style><main role="main"><h1>Marketplace</h1></main>
  <a href="https://www.facebook.com/messages/t/999/">Conversa pessoal fora do Marketplace</a>
  <div role="button" aria-label="Messenger" onclick="showMessenger()">Messenger</div>
  <div id="overlay"></div><div id="chat"></div>
  <script>
  window.unread = true;
  function showMessenger(){document.getElementById('overlay').innerHTML='<div role="dialog" aria-label="Messenger"><a href="https://www.facebook.com/messages/t/999/">Mensagem pessoal que nunca deve ser importada</a><div role="button" onclick="showMarketplace()">Marketplace</div></div>';}
  function showMarketplace(){document.getElementById('overlay').innerHTML='<section id="market-folder"><header>Marketplace</header><a href="https://www.facebook.com/messages/t/123/" aria-label="Conversa em grupo: Cliente · Produto real" onclick="openThread(event)">Cliente · Produto real<br><span id="unread-label">Mensagem não lida:</span><br><span id="preview">Cliente: Olá</span><br>Agora</a><a href="https://www.facebook.com/messages/t/456/" aria-label="Conversa em grupo: Outro · Outro produto" onclick="openThread(event)">Outro · Outro produto<br>Você: Disponível<br>Ontem</a></section>';}
  function openThread(event){event.preventDefault();document.getElementById('unread-label').textContent='';document.getElementById('chat').innerHTML='<section><h2>Cliente · Produto real</h2><span>Marketplace</span><div aria-label="Mensagens"></div><div contenteditable="true" role="textbox" aria-label="Escrever para Cliente"></div><div role="button" aria-label="Fechar conversa" onclick="closeThread()">Fechar</div></section>';}
  function closeThread(){document.getElementById('chat').replaceChildren();}
  function fixtureNewMessage(){document.getElementById('unread-label').textContent='Mensagem não lida:';document.getElementById('preview').textContent='Cliente: Nova mensagem';}
  function fixtureNativeInbox(){document.getElementById('overlay').replaceChildren();document.querySelector('main').innerHTML='<h1>Marketplace</h1><div role="button">Cliente<br>· Produto real<br>Nova mensagem<br>Agora</div><div role="button">Novo cliente<br>· Outro item<br>Disponível?<br>12:00</div>';const tabs=document.createElement('nav');tabs.innerHTML='<div role="tab" aria-selected="false">Venda</div><div role="tab" aria-selected="true">Compra</div>';document.body.prepend(tabs);}
  </script>`;
}
module.exports = { facebookMarketplaceFixture };
