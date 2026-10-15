function attributePortalFixture() {
  return `<div id="fields"></div><div id="portal"></div><script>
  const choices={audio_sound_system_type:['Boombox','Outros'],audio_sound_system_brand:['JBL','Outros'],audio_sound_system_condition:['Novo','Usado - Bom']};
  for(const [id,options] of Object.entries(choices)){
    const component=document.createElement('div');component.className='olx-core-singleselect';
    component.innerHTML='<div id="'+id+'" role="combobox" tabindex="0" aria-expanded="false">Selecione</div><div aria-hidden="true"><ul role="listbox">'+options.map(text=>'<li role="option">'+text+'</li>').join('')+'</ul></div>';
    fields.append(component);document.getElementById(id).onclick=()=>openMenu(id);
  }
  function closeMenus(){for(const menu of portal.children)menu.dataset.state='closed';for(const field of document.querySelectorAll('[role=combobox]'))field.setAttribute('aria-expanded','false');}
  document.body.addEventListener('pointerdown',e=>{if(e.target===document.body)closeMenus();});
  function openMenu(id){closeMenus();const field=document.getElementById(id);field.setAttribute('aria-expanded','true');const list=document.createElement('ul');list.setAttribute('role','listbox');for(const text of choices[id]){const option=document.createElement('li');option.setAttribute('role','option');option.innerText=text;option.onclick=()=>{field.innerText=text;closeMenus();};list.append(option);}const wrapper=document.createElement('div');wrapper.setAttribute('role','dialog');wrapper.dataset.state='open';wrapper.append(list);portal.append(wrapper);}
  </script>`;
}
module.exports = { attributePortalFixture };
