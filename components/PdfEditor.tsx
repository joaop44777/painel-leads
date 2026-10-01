'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createImagePdf, exportPdf, inspectPdf, loadPdf, renderPage } from '../lib/pdf'
import type { EditorElement, PageInfo } from '../lib/types'

type Stage = 'home' | 'editor' | 'review' | 'done'
const icons: Record<string,string> = { select:'↖', text:'T', image:'▧', shape:'□', eraser:'⌫', paint:'✎', layers:'☷', undo:'↶', redo:'↷' }

export default function PdfEditor() {
  const inputRef = useRef<HTMLInputElement>(null), imageInputRef = useRef<HTMLInputElement>(null), fontInputRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<File|null>(null), bytesRef = useRef<Uint8Array|null>(null), pdfRef = useRef<any>(null)
  const canvasRefs = useRef<Record<number, HTMLCanvasElement|null>>({})
  const fontRegistryRef = useRef<Record<string, Uint8Array>>({})
  const fontKeysRef = useRef<Record<string, string>>({})
  const dirtyRef = useRef(false)
  const [stage,setStage]=useState<Stage>('home'), [fileName,setFileName]=useState('Documento.pdf')
  const [pages,setPages]=useState<PageInfo[]>([]), [elements,setElements]=useState<EditorElement[]>([])
  const [selectedId,setSelectedId]=useState<string|null>(null), [activePage,setActivePage]=useState(0), [tool,setTool]=useState('select'), [zoom,setZoom]=useState(1)
  const [leftOpen,setLeftOpen]=useState(true), [rightOpen,setRightOpen]=useState(true), [layersOpen,setLayersOpen]=useState(false), [search,setSearch]=useState('')
  const [busy,setBusy]=useState(''), [error,setError]=useState(''), [history,setHistory]=useState<EditorElement[][]>([]), [future,setFuture]=useState<EditorElement[][]>([]), [editedBytes,setEditedBytes]=useState<Uint8Array|null>(null), [previewBytes,setPreviewBytes]=useState<Uint8Array|null>(null), [fontNames,setFontNames]=useState<string[]>([])
  const selected=elements.find(e=>e.id===selectedId)||null
  const pageElements=useMemo(()=>elements.filter(e=>e.page===activePage&&e.visible!==false),[elements,activePage])

  const snapshot=useCallback(()=>JSON.parse(JSON.stringify(elements)) as EditorElement[],[elements])
  const commit=(next:EditorElement[])=>{ dirtyRef.current=true; setHistory(h=>[...h.slice(-49),snapshot()]); setFuture([]); setElements(next) }
  const updateElement=(id:string,patch:Partial<EditorElement>)=>commit(elements.map(e=>{if(e.id!==id)return e;const next={...e,...patch};if(e.kind==='text'&&(Object.prototype.hasOwnProperty.call(patch,'text')||Object.prototype.hasOwnProperty.call(patch,'fontFamily')||Object.prototype.hasOwnProperty.call(patch,'fontKey')||Object.prototype.hasOwnProperty.call(patch,'fontWeight')||Object.prototype.hasOwnProperty.call(patch,'fontStyle')||Object.prototype.hasOwnProperty.call(patch,'fontSize'))){if(Object.prototype.hasOwnProperty.call(patch,'text'))next.name=`Texto — ${(next.text||'Texto').slice(0,34)}`;next.nativeEdit=next.sourceIndex===undefined?undefined:'pending'}return next}))
  const addElement=(kind:EditorElement['kind'], at?:{x:number;y:number})=>{
    const p=pages[activePage]; if(!p)return
    const id=`${kind}-${Date.now()}`, defaults={
      text:{name:'Texto novo',width:220,height:36,text:'Digite aqui',fontSize:18,color:'#111827'},
      image:{name:'Imagem',width:200,height:150},
      rect:{name:'Retângulo',width:180,height:80,fill:'#4b8cff',opacity:.18},
      ellipse:{name:'Elipse',width:180,height:90,fill:'#4b8cff',opacity:.18},
      line:{name:'Linha',width:180,height:20,stroke:'#1f5fcc',strokeWidth:2},
      arrow:{name:'Seta',width:180,height:20,stroke:'#1f5fcc',strokeWidth:2},
      unknown:{name:'Objeto não identificado',width:160,height:80}
    }[kind]
    const el:EditorElement={id,page:activePage,kind,x:Math.max(15,at?.x ?? p.width/2-defaults.width/2),y:Math.max(15,at?.y ?? p.height/2-defaults.height/2),rotation:0,editable:true,visible:true,nativeEdit:kind==='text'?'pending':undefined,...defaults}
    commit([...elements,el]);setSelectedId(id);setTool('select')
  }

  const openFile=useCallback(async(file:File)=>{
    setError('');setBusy('Lendo e analisando o documento…')
    try{
      let bytes:Uint8Array
      let name=file.name
      if(file.type==='application/pdf'||/\.pdf$/i.test(file.name)) bytes=new Uint8Array(await file.arrayBuffer())
      else if(/^image\/(png|jpeg)$/.test(file.type)||/\.(png|jpe?g)$/i.test(file.name)){bytes=await createImagePdf(file);name=file.name.replace(/\.(png|jpe?g)$/i,'.pdf')}
      else throw new Error('Formato não suportado. Use PDF, JPG ou PNG.')
      const pdf=await loadPdf(bytes); const inspection=await inspectPdf(bytes)
      pdfRef.current=pdf;bytesRef.current=bytes;fileRef.current=file;setFileName(name);setPages(inspection.pages);setElements(inspection.elements);setActivePage(0);setSelectedId(null);setHistory([]);setFuture([]);setPreviewBytes(null);setEditedBytes(null);dirtyRef.current=false;setStage('editor')
    }catch(e:any){setError(e?.message||'Não foi possível abrir o arquivo.')}finally{setBusy('')}
  },[])

  // Renderiza somente a página que está realmente montada no centro do editor.
  // Antes, o efeito renderizava todas as páginas, mas o DOM possui apenas o canvas
  // da página ativa. Como activePage não fazia parte das dependências, clicar na
  // miniatura trocava o estado mas o canvas continuava mostrando a página 1.
  useEffect(()=>{
    if(!pdfRef.current||stage!=='editor')return
    const page=pages.find(p=>p.index===activePage)
    if(!page)return
    let cancelled=false;(async()=>{
      setBusy(previewBytes?'Atualizando visualização…':'Carregando página…')
      const sourcePdf=previewBytes?await loadPdf(previewBytes):pdfRef.current
      const {canvas}=await renderPage(sourcePdf,page.index,1.25*zoom)
      if(cancelled)return
      const target=canvasRefs.current[activePage]
      if(target){
        target.width=canvas.width
        target.height=canvas.height
        const ctx=target.getContext('2d')
        if(ctx)ctx.drawImage(canvas,0,0)
      }
      if(!cancelled)setBusy('')
    })().catch(()=>{if(!cancelled)setBusy('')})
    return()=>{cancelled=true}
  },[pages,activePage,zoom,stage,previewBytes])

  useEffect(()=>{
    if(stage!=='editor'||!bytesRef.current||!dirtyRef.current)return
    let cancelled=false
    const timer=window.setTimeout(async()=>{
      try{
        const cloned=elements.map(e=>({...e}))
        const out=await exportPdf(bytesRef.current!,cloned,pages,fontRegistryRef.current)
        if(!cancelled)setPreviewBytes(out)
      }catch{ /* keep the last valid preview while the user continues editing */ }
    },220)
    return()=>{cancelled=true;window.clearTimeout(timer)}
  },[elements,pages,stage])

  useEffect(()=>{
    if(!pdfRef.current||stage!=='editor')return
    let cancelled=false;(async()=>{
      const thumbs:Record<number,string>={};
      for(const p of pages){if(cancelled)break;const {canvas}=await renderPage(pdfRef.current,p.index,.22);thumbs[p.index]=canvas.toDataURL('image/jpeg',.72)}
      if(!cancelled)setPages(current=>current.map(p=>p.thumbnail? p : {...p,thumbnail:thumbs[p.index]}))
    })(); return()=>{cancelled=true}
  },[stage])

  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{
      const target=e.target as HTMLElement; if(target?.tagName==='INPUT'||target?.tagName==='TEXTAREA')return
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();undo()}
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();redo()}
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();saveEdit()}
      if((e.key==='Delete'||e.key==='Backspace')&&selectedId){e.preventDefault();removeSelected()}
      if(e.key==='Escape')setSelectedId(null)
    };window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey)
  })
  const undo=()=>{if(!history.length)return;dirtyRef.current=true;setFuture(f=>[snapshot(),...f]);setElements(history.at(-1)!);setHistory(h=>h.slice(0,-1));setSelectedId(null)}
  const redo=()=>{if(!future.length)return;dirtyRef.current=true;setHistory(h=>[...h,snapshot()]);setElements(future[0]);setFuture(f=>f.slice(1));setSelectedId(null)}
  const removeSelected=()=>{if(!selectedId)return;commit(elements.filter(e=>e.id!==selectedId));setSelectedId(null)}
  const duplicate=()=>{if(!selected)return;const copy={...selected,id:`${selected.kind}-${Date.now()}`,name:`${selected.name} — cópia`,x:selected.x+14,y:selected.y+14,sourceIndex:undefined,originalText:undefined};commit([...elements,copy]);setSelectedId(copy.id)}
  const saveEdit=async()=>{if(!bytesRef.current)return;setBusy('Gerando e validando o PDF editado…');try{const out=await exportPdf(bytesRef.current,elements.map(e=>({...e})),pages,fontRegistryRef.current);setEditedBytes(out);setPreviewBytes(out);setStage('review')}catch(e:any){setError(e?.message||'Falha ao gerar o PDF.')}finally{setBusy('')}}
  const download=()=>{if(!editedBytes)return;const url=URL.createObjectURL(new Blob([editedBytes],{type:'application/pdf'}));const a=document.createElement('a');a.href=url;a.download=fileName.replace(/\.pdf$/i,'')+'-editado.pdf';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  const importFont=(file:File)=>{
    const ext=(file.name.split('.').pop()||'').toLowerCase()
    if(!['ttf','otf','ttc'].includes(ext)){setError('Use uma fonte .TTF, .OTF ou .TTC.');return}
    const base=file.name.replace(/\.(ttf|otf|ttc)$/i,'')
    const key=`font-${Date.now()}-${base}`
    const reader=new FileReader()
    reader.onload=()=>{
      fontRegistryRef.current[key]=new Uint8Array(reader.result as ArrayBuffer)
      fontKeysRef.current[base]=key
      setFontNames(names=>names.includes(base)?names:[...names,base])
      if(selected?.kind==='text') updateElement(selected.id,{fontFamily:base,fontKey:key,nativeEdit:selected.sourceIndex===undefined?undefined:'fallback'})
      setError('')
    }
    reader.readAsArrayBuffer(file)
  }

  const insertImage=(file:File)=>{const reader=new FileReader();reader.onload=()=>{const src=String(reader.result);const p=pages[activePage];const el:EditorElement={id:`image-${Date.now()}`,page:activePage,kind:'image',name:`Imagem — ${file.name}`,x:p.width/2-100,y:p.height/2-75,width:200,height:150,rotation:0,src,opacity:1,visible:true,editable:true};commit([...elements,el]);setSelectedId(el.id);setTool('select')};reader.readAsDataURL(file)}

  if(stage==='home')return <HomeScreen inputRef={inputRef} onOpen={openFile} busy={busy} error={error}/>
  if(stage==='review')return <ReviewScreen bytes={editedBytes} fileName={fileName} onBack={()=>setStage('editor')} onFinish={()=>setStage('done')} busy={busy} error={error}/>
  if(stage==='done')return <DoneScreen fileName={fileName} onDownload={download} onHome={()=>setStage('home')}/>

  return <main className="app-shell">
    <aside className="app-nav">
      <div className="nav-brand"><div className="brand-mark large">P</div><div><strong>PDF Studio</strong><span>EDITOR PROFISSIONAL</span></div></div>
      <nav className="nav-menu">
        <button className="nav-item active"><span>✎</span>Editar PDF</button>
        <button className="nav-item" onClick={()=>setLayersOpen(true)}><span>▤</span>Meus arquivos</button>
        <button className="nav-item"><span>⚙</span>Configurações</button>
      </nav>
      <div className="nav-footer"><span>Privacidade local</span><small>Sem contas · sem envio obrigatório</small></div>
    </aside>
    <div className="editor-main">
      <header className="topbar"><div className="editor-heading"><h1>Editar PDF</h1><p>Faça as alterações que precisar no seu documento.</p></div><div className="doc-name"><span>{fileName}</span><small>{pages.length} {pages.length===1?'página':'páginas'}</small></div><div className="top-actions"><button className="icon-btn" title="Desfazer" onClick={undo} disabled={!history.length}>{icons.undo}</button><button className="icon-btn" title="Refazer" onClick={redo} disabled={!future.length}>{icons.redo}</button><button className="ghost-btn" onClick={()=>setLeftOpen(v=>!v)}>Páginas</button><button className="ghost-btn" onClick={()=>setLayersOpen(v=>!v)}>Elementos</button><button className="save-btn" onClick={saveEdit}>Salvar Edição</button></div></header>
      <section className="workspace">
      {leftOpen&&<aside className="sidebar pages-sidebar"><div className="panel-title"><span>Páginas</span><span className="count">{pages.length}</span></div><div className="thumbs">{pages.map(p=><button key={p.index} className={`thumb ${activePage===p.index?'active':''}`} onClick={()=>{setActivePage(p.index);setSelectedId(null)}}><div className="thumb-page">{p.thumbnail?<img src={p.thumbnail} alt=""/>:<span>{p.index+1}</span>}</div><small>Página {p.index+1}</small></button>)}</div></aside>}
      <div className="canvas-area"><div className="canvas-toolbar"><div className="tool-group">{([['select','Selecionar'],['text','Texto'],['image','Imagem'],['shape','Formas'],['eraser','Borracha'],['paint','Pintar']] as const).map(([id,label])=><button key={id} className={`tool-btn ${tool===id?'active':''}`} title={label} onClick={()=>id==='text'?setTool('text'):id==='shape'?addElement('rect'):id==='image'?imageInputRef.current?.click():setTool(id)}><span>{icons[id]}</span><em>{label}</em></button>)}</div><div className="zoom"><button onClick={()=>setZoom(z=>Math.max(.7,z-.1))}>−</button><span>{Math.round(zoom*100)}%</span><button onClick={()=>setZoom(z=>Math.min(1.8,z+.1))}>+</button></div><input ref={fontInputRef} hidden type="file" accept=".ttf,.otf,.ttc,font/ttf,font/otf" onChange={e=>{const f=e.target.files?.[0];if(f)importFont(f);e.currentTarget.value=''}}/><input ref={imageInputRef} hidden type="file" accept="image/png,image/jpeg" onChange={e=>{const f=e.target.files?.[0];if(f)insertImage(f);e.currentTarget.value=''}}/></div>
        <div className="document-stage"><div className="page-wrap" style={{width:(pages[activePage]?.width||595)*1.25*zoom,height:(pages[activePage]?.height||842)*1.25*zoom}} onMouseDown={e=>{if(tool==='text'){const r=(e.currentTarget as HTMLElement).getBoundingClientRect();addElement('text',{x:(e.clientX-r.left)/(1.25*zoom),y:(e.clientY-r.top)/(1.25*zoom)});return} if(tool==='select')setSelectedId(null)}}><canvas ref={el=>{canvasRefs.current[activePage]=el}} className="pdf-canvas"/>{pageElements.map(el=><ElementOverlay key={el.id} el={el} zoom={1.25*zoom} selected={selectedId===el.id} onSelect={(ev)=>{ev.stopPropagation();setSelectedId(el.id);setTool('select')}} onChange={patch=>updateElement(el.id,patch)} interactive={tool!=='text'}/>)}</div></div>
      </div>
      {rightOpen&&<aside className="sidebar properties-sidebar"><div className="panel-tabs"><button className="panel-tab active">Editar</button><button className="panel-tab">Anotações</button><button className="mini" onClick={()=>setRightOpen(false)}>×</button></div>{!selected?<div className="tool-cards"><button className="feature-card" onClick={()=>setTool('text')}><span className="feature-icon">T</span><span><b>Texto</b><small>Adicione ou edite textos</small></span><i>›</i></button><button className="feature-card" onClick={()=>imageInputRef.current?.click()}><span className="feature-icon">▧</span><span><b>Imagem</b><small>Insira imagens no seu PDF</small></span><i>›</i></button><button className="feature-card" onClick={()=>setTool('select')}><span className="feature-icon">↗</span><span><b>Link</b><small>Adicione links clicáveis</small></span><i>›</i></button><button className="feature-card" onClick={()=>addElement('rect')}><span className="feature-icon">○</span><span><b>Formas</b><small>Desenhe formas e destaque trechos</small></span><i>›</i></button><button className="feature-card" onClick={()=>setLeftOpen(v=>!v)}><span className="feature-icon">▤</span><span><b>Página</b><small>Gerencie páginas e navegação</small></span><i>›</i></button><div className="tool-tip"><span>✦</span><p><b>Dica</b><br/>Após fazer as edições, clique em <strong>Salvar Edição</strong> e depois em <strong>Baixar</strong> para concluir.</p></div><div className="panel-actions"><button className="panel-save secondary-save" onClick={saveEdit}>Salvar Edição</button><button className="panel-save panel-download" onClick={async()=>{if(!editedBytes){await saveEdit();return}download()}}>↓&nbsp; Baixar</button></div></div>:<Properties selected={selected} update={patch=>updateElement(selected.id,patch)} fontNames={fontNames} fontKeys={fontKeysRef.current} onImportFont={()=>fontInputRef.current?.click()} onDelete={removeSelected} onDuplicate={duplicate} onFront={()=>{const idx=elements.findIndex(e=>e.id===selected.id);if(idx<0)return;const a=[...elements],x=a.splice(idx,1)[0];a.push(x);commit(a)}} onBack={()=>{const idx=elements.findIndex(e=>e.id===selected.id);if(idx<0)return;const a=[...elements],x=a.splice(idx,1)[0];a.unshift(x);commit(a)}}/>}</aside>}
      </section>
    </div>
    {layersOpen&&<div className="drawer-backdrop" onMouseDown={()=>setLayersOpen(false)}><aside className="layers-drawer" onMouseDown={e=>e.stopPropagation()}><div className="drawer-head"><div><span className="eyebrow">ESTRUTURA</span><h2>Elementos</h2></div><button className="mini" onClick={()=>setLayersOpen(false)}>×</button></div><div className="search"><span>⌕</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Pesquisar em todas as páginas"/></div><div className="layer-list">{pages.map(p=>{const list=elements.filter(e=>e.page===p.index&&e.visible!==false&&(!search||e.name.toLowerCase().includes(search.toLowerCase())||(e.text||'').toLowerCase().includes(search.toLowerCase())));if(!list.length)return null;return <div key={p.index} className="page-group"><div className="layer-page">Página {p.index+1}<span>{list.length}</span></div>{list.map(el=><button key={el.id} className={`layer-row ${selectedId===el.id?'selected':''}`} onClick={()=>{setActivePage(p.index);setSelectedId(el.id);setLayersOpen(false)}}><span className="layer-kind">{el.kind==='text'?'T':el.kind==='image'?'▧':el.kind==='rect'?'□':el.kind==='ellipse'?'○':el.kind==='arrow'?'➜':'—'}</span><span>{el.name}</span></button>)}</div>})}</div></aside></div>}
    {busy&&<div className="busy"><div className="spinner"/><span>{busy}</span></div>}{error&&<div className="toast error">{error}<button onClick={()=>setError('')}>×</button></div>}
  </main>
}

function HomeScreen({inputRef,onOpen,busy,error}:{inputRef:React.RefObject<HTMLInputElement|null>;onOpen:(f:File)=>void;busy:string;error:string}){return <main className="home"><div className="home-card"><div className="home-brand"><div className="brand-mark large">P</div><div><strong>PDF Studio</strong><span>editor profissional</span></div></div><div className="home-copy"><span className="eyebrow">EDITOR LOCAL · PRIVACIDADE</span><h1>Edite seus PDFs<br/><b>sem complicação.</b></h1><p>Texto, imagens, elementos e páginas em um espaço de trabalho limpo. O documento fica no centro; as ferramentas aparecem quando você precisa.</p></div><button className="open-btn" onClick={()=>inputRef.current?.click()}><span>＋</span><div><strong>Abrir arquivo</strong><small>PDF, JPG, PNG ou arraste aqui</small></div></button><div className="dropzone" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const f=e.dataTransfer.files[0];if(f)onOpen(f)}}>Solte um arquivo nesta área</div><input ref={inputRef} hidden type="file" accept="application/pdf,.pdf,image/png,image/jpeg" onChange={e=>{const f=e.target.files?.[0];if(f)onOpen(f);e.currentTarget.value=''}}/>{busy&&<div className="home-status"><div className="spinner"/>{busy}</div>}{error&&<div className="home-error">{error}</div>}<footer>Processamento local sempre que possível · sem contas</footer></div></main>}

function Properties({selected,update,fontNames,fontKeys,onImportFont,onDelete,onDuplicate,onFront,onBack}:{selected:EditorElement;update:(p:Partial<EditorElement>)=>void;fontNames:string[];fontKeys:Record<string,string>;onImportFont:()=>void;onDelete:()=>void;onDuplicate:()=>void;onFront:()=>void;onBack:()=>void}){return <div className="props">
 {selected.kind==='text'&&<><label>Conteúdo<textarea autoFocus={false} value={selected.text||''} onChange={e=>update({text:e.target.value})} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&selected.sourceIndex!==undefined){e.preventDefault();(e.currentTarget as HTMLTextAreaElement).blur()}}}/></label><div className="grid2"><label>Tamanho<input type="number" min="6" max="144" value={selected.fontSize||12} onChange={e=>update({fontSize:Number(e.target.value)})}/></label><label>Cor<input type="color" value={selected.color||'#111827'} onChange={e=>update({color:e.target.value})}/></label></div><label>Fonte<select value={selected.fontFamily||'Helvetica'} onChange={e=>{const value=e.target.value;update({fontFamily:value,fontKey:fontKeys[value]})}}><option>Helvetica</option><option>Times</option><option>Courier</option>{selected.fontFamily&&!['Helvetica','Times','Courier'].includes(selected.fontFamily)&&<option value={selected.fontFamily}>{selected.fontFamily}</option>}{fontNames.filter(n=>n!==selected.fontFamily).map(n=><option key={n} value={n}>{n}</option>)}</select><button type="button" className="font-import-btn" onClick={onImportFont}>+ Adicionar fonte (.TTF/.OTF)</button></label><div className="text-style-row"><button className={selected.fontWeight==='bold'?'active':''} onClick={()=>update({fontWeight:selected.fontWeight==='bold'?'normal':'bold'})}><b>B</b></button><button className={selected.fontStyle==='italic'?'active':''} onClick={()=>update({fontStyle:selected.fontStyle==='italic'?'normal':'italic'})}><i>I</i></button><button className={selected.underline?'active':''} onClick={()=>update({underline:!selected.underline})}><u>U</u></button><button className={selected.textAlign==='left'?'active':''} onClick={()=>update({textAlign:'left'})}>L</button><button className={selected.textAlign==='center'?'active':''} onClick={()=>update({textAlign:'center'})}>C</button><button className={selected.textAlign==='right'?'active':''} onClick={()=>update({textAlign:'right'})}>R</button></div><label>Entrelinha<input type="number" min=".8" max="3" step=".05" value={selected.lineHeight||1.15} onChange={e=>update({lineHeight:Number(e.target.value)})}/></label><small className="native-status">{selected.nativeEdit==='applied'?'Edição nativa preparada para este objeto.':selected.nativeEdit==='fallback'?'Este PDF usará uma substituição visual controlada ao exportar.':'Texto original do PDF.'}</small></>}
 {selected.kind==='image'&&<label>Opacidade<input type="range" min=".05" max="1" step=".05" value={selected.opacity??1} onChange={e=>update({opacity:Number(e.target.value)})}/></label>}
 {['rect','ellipse','line','arrow'].includes(selected.kind)&&<><label>Cor<input type="color" value={selected.stroke||'#1f5fcc'} onChange={e=>update({stroke:e.target.value})}/></label>{['rect','ellipse'].includes(selected.kind)&&<label>Preenchimento<input type="color" value={selected.fill||'#4b8cff'} onChange={e=>update({fill:e.target.value})}/></label>}<label>Espessura<input type="number" min="0" value={selected.strokeWidth||1} onChange={e=>update({strokeWidth:Number(e.target.value)})}/></label><label>Opacidade<input type="range" min=".05" max="1" step=".05" value={selected.opacity??1} onChange={e=>update({opacity:Number(e.target.value)})}/></label></>}
 <div className="section-title">Transformar</div><div className="grid2">{[['X','x'],['Y','y'],['Largura','width'],['Altura','height'],['Rotação','rotation']].map(([label,key])=><label key={key}>{label}<input type="number" value={Math.round((selected as any)[key])} onChange={e=>update({[key]:Number(e.target.value)} as any)}/></label>)}</div>
 <div className="props-actions"><button className="outline-btn" onClick={onFront}>Trazer para frente</button><button className="outline-btn" onClick={onBack}>Enviar para trás</button><button className="outline-btn" onClick={onDuplicate}>Duplicar</button><button className="outline-btn danger-btn" onClick={onDelete}>Excluir</button></div>
 </div>}

function ElementOverlay({el,zoom,selected,onSelect,onChange,interactive}:{el:EditorElement;zoom:number;selected:boolean;onSelect:(e:React.MouseEvent)=>void;onChange:(p:Partial<EditorElement>)=>void;interactive:boolean}){
 const drag=useRef<{x:number;y:number;mode:'move'|'resize'|'rotate';sx:number;sy:number;sw:number;sh:number;sa:number}|null>(null)
 const style:React.CSSProperties={left:el.x*zoom,top:el.y*zoom,width:Math.max(4,el.width)*zoom,height:Math.max(4,el.height)*zoom,transform:`rotate(${el.rotation}deg)`,opacity:el.opacity??1,pointerEvents:interactive?'auto':'none'}
 const start=(ev:React.MouseEvent,mode:'move'|'resize'|'rotate')=>{ev.stopPropagation();onSelect(ev);drag.current={x:ev.clientX,y:ev.clientY,mode,sx:el.x,sy:el.y,sw:el.width,sh:el.height,sa:el.rotation};const move=(e:MouseEvent)=>{const d=drag.current;if(!d)return;const dx=(e.clientX-d.x)/zoom,dy=(e.clientY-d.y)/zoom;if(d.mode==='move')onChange({x:d.sx+dx,y:d.sy+dy});else if(d.mode==='resize')onChange({width:Math.max(8,d.sw+dx),height:Math.max(8,d.sh+dy)});else onChange({rotation:d.sa+dx*.7})};const up=()=>{drag.current=null;window.removeEventListener('mousemove',move);window.removeEventListener('mouseup',up)};window.addEventListener('mousemove',move);window.addEventListener('mouseup',up)}
 const isSourceText=el.kind==='text'&&el.sourceIndex!==undefined
 // Native PDF text is already painted by PDF.js. For source text objects we
 // keep only an invisible hit area until selected; rendering the text again
 // here would create the exact double-text effect seen in the deployed build.
 const showText=el.kind==='text' && !isSourceText
 return <div className={`element ${selected?'selected':''} kind-${el.kind} ${isSourceText?'source-text':''}`} style={{...style, ...(isSourceText && !selected ? {pointerEvents: interactive ? 'auto' : 'none', background:'transparent'} : {})}} onMouseDown={e=>start(e,'move')}>
  {showText&&<span style={{fontSize:(el.fontSize||12)*zoom,color:el.color||'#111827',fontFamily:el.fontFamily||'Arial,sans-serif',fontWeight:el.fontWeight||'normal',fontStyle:el.fontStyle||'normal',textDecoration:el.underline?'underline':'none',textAlign:el.textAlign||'left',display:'block',whiteSpace:'pre-wrap',lineHeight:el.lineHeight||1.15}}>{el.text}</span>}
  {el.kind==='image'&&el.src&&<img src={el.src} alt="" draggable={false}/>} {el.kind==='ellipse'&&<div className="shape-fill ellipse-fill"/>}
  {selected&&<><i className="handle nw"/><i className="handle ne"/><i className="handle sw"/><i className="handle se" onMouseDown={e=>start(e,'resize')}/><i className="rotate-handle" onMouseDown={e=>start(e,'rotate')}/></>}
 </div>
}

function ReviewScreen({bytes,fileName,onBack,onFinish,busy,error}:{bytes:Uint8Array|null;fileName:string;onBack:()=>void;onFinish:()=>void;busy:string;error:string}){const url=useMemo(()=>bytes?URL.createObjectURL(new Blob([bytes],{type:'application/pdf'})):null,[bytes]);useEffect(()=>()=>{if(url)URL.revokeObjectURL(url)},[url]);return <main className="review"><header className="review-head"><div className="brand"><div className="brand-mark">P</div><div><strong>PDF Studio</strong><span>conferência</span></div></div><div className="review-status"><span className="ok-dot"/>Edição salva</div></header><div className="review-body"><div className="review-copy"><span className="eyebrow">PDF EDITADO</span><h1>Confira o resultado<br/><b>antes de baixar.</b></h1><p>Esta visualização usa o PDF gerado na etapa de salvamento. Se algo não estiver certo, volte para o editor.</p><div className="review-actions"><button className="secondary" onClick={onBack}>← Voltar para editar</button><button className="primary" onClick={onFinish}>Prosseguir para o download →</button></div><small>{fileName.replace(/\.pdf$/i,'')}-editado.pdf</small></div><div className="review-frame">{url?<iframe title="PDF editado" src={url}/>:<div>PDF indisponível</div>}</div></div>{busy&&<div className="busy"><div className="spinner"/>{busy}</div>}{error&&<div className="toast error">{error}</div>}</main>}
function DoneScreen({fileName,onDownload,onHome}:{fileName:string;onDownload:()=>void;onHome:()=>void}){return <main className="done"><div className="done-card"><div className="success-icon">✓</div><span className="eyebrow">FINALIZADO</span><h1>Seu PDF está pronto.</h1><p>{fileName.replace(/\.pdf$/i,'')}-editado.pdf</p><button className="primary large" onClick={onDownload}>↓ Baixar PDF</button><button className="link-btn" onClick={onHome}>Voltar ao início</button></div></main>}
