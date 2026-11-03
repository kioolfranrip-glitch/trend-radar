import fs from 'node:fs';
const ne = JSON.parse(fs.readFileSync('./tools/ne_110m_countries.geojson','utf8'));
const probe = JSON.parse(fs.readFileSync('./tools/google-coverage.json','utf8'));
const googleOk = new Set(Object.entries(probe).filter(([,v])=>v>0).map(([k])=>k));
['TW','HK','SG'].forEach(c=>googleOk.add(c));

const isoOf = p => {
  const a = p.ISO_A2_EH, b = p.ISO_A2;
  if (/^[A-Z]{2}$/.test(a||'')) return a;
  if (/^[A-Z]{2}$/.test(b||'')) return b;
  return null;
};

// 中文简称（地图与卡片用简称，详情页用全名）
const nameZhShort = {
  CN:'中国', US:'美国', GB:'英国', KR:'韩国', KP:'朝鲜', RU:'俄罗斯', JP:'日本', IN:'印度',
  TW:'中国台湾', HK:'中国香港', MO:'中国澳门', AE:'阿联酋', CZ:'捷克', NL:'荷兰', CH:'瑞士',
  SA:'沙特', ZA:'南非', NZ:'新西兰', VN:'越南', PH:'菲律宾', ID:'印尼', MY:'马来西亚',
  SG:'新加坡', TH:'泰国', MM:'缅甸', KH:'柬埔寨', LA:'老挝', BD:'孟加拉国', PK:'巴基斯坦',
  LK:'斯里兰卡', NP:'尼泊尔', IR:'伊朗', IQ:'伊拉克', IL:'以色列', SY:'叙利亚', JO:'约旦',
  LB:'黎巴嫩', KW:'科威特', QA:'卡塔尔', OM:'阿曼', YE:'也门', TR:'土耳其', EG:'埃及',
  DZ:'阿尔及利亚', MA:'摩洛哥', TN:'突尼斯', LY:'利比亚', NG:'尼日利亚', KE:'肯尼亚',
  ET:'埃塞俄比亚', GH:'加纳', TZ:'坦桑尼亚', UG:'乌干达', ZM:'赞比亚', ZW:'津巴布韦',
  MZ:'莫桑比克', AO:'安哥拉', CD:'刚果（金）', CM:'喀麦隆', CI:'科特迪瓦', SN:'塞内加尔',
  ML:'马里', BF:'布基纳法索', NE:'尼日尔', TD:'乍得', SO:'索马里', SD:'苏丹', SS:'南苏丹',
  DE:'德国', FR:'法国', IT:'意大利', ES:'西班牙', PT:'葡萄牙', IE:'爱尔兰', AT:'奥地利',
  BE:'比利时', LU:'卢森堡', DK:'丹麦', SE:'瑞典', NO:'挪威', FI:'芬兰', IS:'冰岛',
  PL:'波兰', HU:'匈牙利', RO:'罗马尼亚', BG:'保加利亚', GR:'希腊', HR:'克罗地亚',
  RS:'塞尔维亚', SI:'斯洛文尼亚', SK:'斯洛伐克', BA:'波黑', ME:'黑山', MK:'北马其顿',
  AL:'阿尔巴尼亚', EE:'爱沙尼亚', LV:'拉脱维亚', LT:'立陶宛', UA:'乌克兰', BY:'白俄罗斯',
  MD:'摩尔多瓦', GE:'格鲁吉亚', AM:'亚美尼亚', AZ:'阿塞拜疆', KZ:'哈萨克斯坦', UZ:'乌兹别克斯坦',
  TM:'土库曼斯坦', KG:'吉尔吉斯斯坦', TJ:'塔吉克斯坦', MN:'蒙古', CA:'加拿大', MX:'墨西哥',
  BR:'巴西', AR:'阿根廷', CL:'智利', CO:'哥伦比亚', PE:'秘鲁', VE:'委内瑞拉', EC:'厄瓜多尔',
  BO:'玻利维亚', PY:'巴拉圭', UY:'乌拉圭', CU:'古巴', DO:'多米尼加', HT:'海地', JM:'牙买加',
  TT:'特立尼达和多巴哥', PA:'巴拿马', CR:'哥斯达黎加', GT:'危地马拉', HN:'洪都拉斯',
  SV:'萨尔瓦多', NI:'尼加拉瓜', BZ:'伯利兹', AU:'澳大利亚', FJ:'斐济', PG:'巴布亚新几内亚',
  XK:'科索沃', CY:'塞浦路斯', MT:'马耳他', BN:'文莱', TL:'东帝汶', BT:'不丹', MV:'马尔代夫',
};

const out = [];
for (const f of ne.features) {
  const p = f.properties;
  if (p.CONTINENT === 'Antarctica' || p.CONTINENT === 'Seven seas (open ocean)') continue;
  const iso = isoOf(p);
  if (!iso) continue;
  out.push({
    iso,
    iso3: p.ADM0_A3,
    nameEn: p.NAME_EN || p.ADMIN,
    nameZh: p.NAME_ZH || p.NAME_EN,
    nameZhShort: nameZhShort[iso] || p.NAME_ZH || p.NAME_EN,
    nameLocal: p.ADMIN,
    continent: p.CONTINENT,
    subregion: p.SUBREGION,
    lat: Number(p.LABEL_Y) || null,
    lon: Number(p.LABEL_X) || null,
    google: googleOk.has(iso),
    baidu: iso === 'CN',
    wiki: true,
  });
}

// 地图上没有独立要素、但用户一定想看的地区
const extraRegions = [
  { iso:'HK', iso3:'HKG', nameEn:'Hong Kong', nameZh:'中国香港特别行政区', nameZhShort:'中国香港', nameLocal:'Hong Kong', continent:'Asia', subregion:'Eastern Asia', lat:22.4, lon:114.1, google:true, baidu:false, wiki:true },
  { iso:'MO', iso3:'MAC', nameEn:'Macao', nameZh:'中国澳门特别行政区', nameZhShort:'中国澳门', nameLocal:'Macao', continent:'Asia', subregion:'Eastern Asia', lat:22.17, lon:113.55, google:false, baidu:false, wiki:true },
  { iso:'SG', iso3:'SGP', nameEn:'Singapore', nameZh:'新加坡共和国', nameZhShort:'新加坡', nameLocal:'Singapore', continent:'Asia', subregion:'South-Eastern Asia', lat:1.35, lon:103.8, google:true, baidu:false, wiki:true },
];
for (const r of extraRegions) if (!out.some((c) => c.iso === r.iso)) out.push(r);

// 中国统一使用简体标准名称
const cn = out.find((c) => c.iso === 'CN');
if (cn) { cn.nameZh = '中国'; cn.nameZhShort = '中国'; }

out.sort((a, b) => a.nameZhShort.localeCompare(b.nameZhShort, 'zh-Hans-CN'));
fs.writeFileSync('./data/countries.json', JSON.stringify(out, null, 0));
console.log('countries', out.length, 'google', out.filter((c) => c.google).length);
