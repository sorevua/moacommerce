/* Browser canvas engine for product detail pages. */
(function (root) {
  'use strict';
  const width = 860;
  const themes = {
    farm: {paper:'#f6eee0',ink:'#492a20',accent:'#a13e27',panel:'#eddcc6',muted:'#715549',serif:true},
    luxury: {paper:'#fbf5eb',ink:'#362c24',accent:'#78502e',panel:'#eaddca',muted:'#64554b',serif:true},
    fresh: {paper:'#f2f7ee',ink:'#204334',accent:'#27614b',panel:'#e0ebdc',muted:'#466658',serif:false}
  };
  const empty = {
    theme:'farm', brand:'', title:'', subtitle:'',
    point1:'', desc1:'', point2:'', desc2:'', point3:'', desc3:'',
    origin:'', option:'', care:'', shipping:'', notes:'', sample:false
  };

  function render(canvas, input = {}, photo = null) {
    const ctx = canvas.getContext('2d');
    const product = {...empty, ...input};
    for (const key of Object.keys(empty)) {
      if (typeof empty[key] === 'string' && typeof product[key] !== 'string') {
        product[key] = empty[key];
      }
    }
    product.photo = Boolean(photo || input.photo);
    const sans = '"Noto Sans KR", sans-serif';
    const serif = '"Gowun Batang", Georgia, serif';
    function font(size, weight, family = sans) { ctx.font = `${weight} ${size}px ${family}`; }
    function lines(value, max) {
      return String(value).split('\n').flatMap(part => {
        const result = [];
        let line = '';
        for (const char of part) {
          if (line && ctx.measureText(line + char).width > max) {
            result.push(line.trimEnd());
            line = char.trimStart();
          } else line += char;
        }
        result.push(line.trimEnd());
        return result;
      });
    }
    function block(value, {x=64,y,max=732,size=24,line=37,weight=500,color,family=sans,align='left',draw}) {
      font(size,weight,family);
      const wrapped = lines(value,max);
      if (draw) {
        ctx.fillStyle = color;
        ctx.textAlign = align;
        wrapped.forEach((part,i) => ctx.fillText(part,x,y+i*line));
        ctx.textAlign = 'left';
      }
      return y+wrapped.length*line;
    }
    function rectangle(color,x,y,w,h,draw) {
      if (!draw) return;
      ctx.fillStyle=color;
      ctx.fillRect(x,y,w,h);
    }
    function renderPass(draw) {
      const t = themes[product.theme] ?? themes.farm;
      const common = {draw,color:t.ink};
      ctx.textBaseline = 'top';
      rectangle(t.paper,0,0,width,canvas.height,draw);
      const brand = product.brand.trim();
      const title = product.title.trim() || '상품명을 입력하세요';
      let y = 54;
      if (brand) y = block(brand,{...common,x:430,y,max:690,size:23,line:30,weight:800,color:t.accent,align:'center'})+26;
      const size = title.length > 23 ? 50 : 65;
      y = block(title,{...common,x:430,y,max:720,size,line:size+15,weight:800,family:t.serif?serif:sans,align:'center'})+10;
      if (product.subtitle.trim()) y=block(product.subtitle.trim(),{...common,x:430,y,max:713,size:27,line:41,color:t.muted,align:'center'})+17;
      y+=18;
      const frame = product.theme === 'luxury' ? 60 : product.theme === 'fresh' ? 36 : 0;
      const imageWidth = width - frame * 2;
      const imageHeight = product.theme === 'luxury' ? 695 : product.theme === 'fresh' ? 540 : 645;
      if (draw && photo) {
        const scale = Math.max(imageWidth/photo.naturalWidth,imageHeight/photo.naturalHeight);
        const sw=imageWidth/scale, sh=imageHeight/scale;
        ctx.drawImage(photo,(photo.naturalWidth-sw)/2,(photo.naturalHeight-sh)/2,sw,sh,frame,y,imageWidth,imageHeight);
      } else if (product.photo || !draw) {
        if (product.photo) {
          rectangle(t.panel,frame,y,imageWidth,imageHeight,draw);
          block('대표 상품 사진',{...common,x:430,y:y+300,size:34,align:'center',color:t.muted});
        }
      }
      if (product.photo) y+=imageHeight;
      const points = [1,2,3].map(i=>[product['point'+i].trim(),product['desc'+i].trim()]).filter(pair=>pair.some(Boolean));
      if (points.length) {
        y += 60;
        y=block('상품의 특징',{...common,y,size:38,line:53,weight:800,family:t.serif?serif:sans})+19;
        for (const [head,body] of points) {
          rectangle(t.accent,64,y+8,19,3,draw);
          if(head) y=block(head,{...common,x:100,y,max:690,size:30,line:43,weight:800});
          if(body) y=block(body,{...common,x:100,y,max:685,size:24,line:39,color:t.muted});
          y+=24;
        }
      }
      const facts=[['원산지',product.origin],['구성·중량',product.option],['보관·사용 방법',product.care],['배송 안내',product.shipping],['추가 안내',product.notes]].filter(([,value])=>value.trim());
      if(facts.length) {
        const start=y+30;
        y=start+42;
        const layoutFacts = paint => {
          let offset = block('상품 안내',{...common,draw:paint,y:start+42,size:36,line:51,weight:800})+15;
          for(const [label,value] of facts) {
            rectangle(t.accent,64,offset,732,1,paint);
            const labelEnd=block(label,{...common,draw:paint,y:offset+17,max:161,size:22,line:35,weight:800});
            const valueEnd=block(value.trim(),{...common,draw:paint,x:241,y:offset+17,max:555,size:22,line:35,color:t.muted});
            offset=Math.max(labelEnd,valueEnd)+25;
          }
          return offset+22;
        };
        y=layoutFacts(false);
        rectangle(t.panel,0,start,width,y-start,draw);
        if(draw) layoutFacts(true);
      }
      if(product.sample) {
        y=block('편집용 예시 · 상품 정보와 사진을 확인 후 교체하세요.',{...common,x:430,y:y+23,size:19,line:30,color:t.muted,align:'center'})+17;
      }
      return Math.ceil(y+36);
    }

    const height = renderPass(false);
    canvas.width = width;
    canvas.height = height;
    renderPass(true);
    return { width, height };
  }

  root.DetailStudioEngine = Object.freeze({ render });
})(window);
