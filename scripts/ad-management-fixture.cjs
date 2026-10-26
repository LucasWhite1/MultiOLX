function adManagementFixture() {
  return `<!doctype html><meta charset="utf-8"><title>Meus anúncios — fixture isolada</title>
  <style>article{border:1px solid #ddd;padding:16px;margin:12px}dialog{background:white;padding:24px}</style>
  <h1>Meus anúncios publicados</h1><main></main><p id="result"></p>
  <dialog aria-label="Excluir anúncio"><h2>Excluir anúncio?</h2><p id="name"></p><label>Motivo<select><option value="">Selecione</option><option value="sold">Vendi pela OLX</option><option value="other">Não quero mais anunciar</option></select></label><button id="confirm" disabled>Excluir anúncio</button><button onclick="document.querySelector('dialog').close()">Cancelar</button></dialog>
  <dialog id="delivery-tour"><h2>Faça a entrega pela OLX, é fácil e gratuito</h2><p>Ative o nosso serviço de entrega.</p><button aria-label="Fechar" onclick="sessionStorage.setItem('delivery-tour-dismissed','yes');this.closest('dialog').close()">×</button><button>Próximo</button></dialog>
  <script>
  const ads=[{id:'123456781',title:'Caixa de som',price:'R$ 100,00',page:1},{id:'123456782',title:'Caixa de som',price:'R$ 110,00',page:2},{id:'123456783',title:'Produto único preservado',price:'R$ 50,00',page:1}];
  let current; const dialog=document.querySelector('dialog');
  const removed=()=>JSON.parse(sessionStorage.getItem('removed-ads')||'[]');
  const completed=new URL(location.href).searchParams.get('fixtureRemoved');
  if(completed==='123456782'){sessionStorage.setItem('removed-ads',JSON.stringify([...new Set([...removed(),completed])]));document.querySelector('#result').textContent='Anúncio foi excluído com sucesso.';}
  function render(){const page=Number(new URL(location.href).searchParams.get('page')||1);const list=ads.filter(a=>a.page===page&&!removed().includes(a.id));document.querySelector('main').innerHTML=list.map(a=>'<article><a href="https://www.olx.com.br/vi/'+a.id+'">'+a.title+'</a><p>PUBLICADO</p><p>'+a.price+'</p><p>'+(a.id==='123456781'?'3 visitas 14/10/26 às 17:39 · Mensagens recebidas: 7':'0 visitas 15/10/26 às 17:39')+'</p><button data-id="'+a.id+'">Excluir</button></article>').join('')+(!list.length?'<p>Nenhum anúncio</p>':'')+(page===1?'<a rel="next" href="?page=2">Próxima página</a>':'');document.querySelectorAll('button[data-id]').forEach(b=>b.onclick=()=>{current=ads.find(a=>a.id===b.dataset.id);document.querySelector('#name').textContent=current.title;document.querySelector('select').value='';document.querySelector('#confirm').disabled=true;dialog.showModal()});}
  document.querySelector('select').onchange=e=>document.querySelector('#confirm').disabled=!e.target.value;
  document.querySelector('#confirm').onclick=()=>{if(document.querySelector('select').value!=='other')throw Error('Motivo incorreto');if(current.id==='123456782'){location.href='https://adquirir.olx.com.br/destaques?action=deletion&legacyAdId=987654321';return;}sessionStorage.setItem('removed-ads',JSON.stringify([...removed(),current.id]));dialog.close();document.querySelector('#result').textContent='Anúncio excluído com sucesso.';render()};render();
  if(!sessionStorage.getItem('delivery-tour-dismissed'))document.getElementById('delivery-tour').showModal();
  </script>`;
}
function adDeletionOfferFixture() {
  return `<!doctype html><meta charset="utf-8"><h1>Que tal destacar seu anúncio e ser visto por mais pessoas?</h1>
  <label><input type="radio" name="offer" aria-label="PACKAGE_SILVER" onclick="throw Error('Não selecione destaque pago')">Destaque Prata R$ 51,99</label>
  <label><input type="radio" name="offer" aria-label="PACKAGE_GOLD" onclick="throw Error('Não selecione destaque pago')">Destaque Ouro R$ 56,99</label>
  <label><input type="radio" name="offer" aria-label="NO_PRODUCT">Excluir <span>Seu anúncio será excluído da OLX.</span></label>
  <button disabled>Continuar</button><script>const free=document.querySelector('[aria-label=NO_PRODUCT]');free.onchange=()=>document.querySelector('button').disabled=!free.checked;document.querySelector('button').onclick=()=>{if(!free.checked||document.querySelector('[aria-label^=PACKAGE]:checked'))throw Error('Destaque selecionado');location.href='https://conta.olx.com.br/anuncios/publicados?fixtureRemoved=123456782';};</script>`;
}
module.exports = { adManagementFixture, adDeletionOfferFixture };
