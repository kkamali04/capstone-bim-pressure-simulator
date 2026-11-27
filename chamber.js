import {blankEngineering} from './engineering.js';
export const CHAMBER_ID='CHAMBER';
export function chamberSettings(input={}){
  const units=input.units??'ft',scale=units==='ft'?.3048:units==='m'?1:NaN;
  if(!Number.isFinite(scale))throw Error('Choose feet or meters.');
  const dimensions=['width','depth','height'].map(key=>Number(input[key]));
  if(dimensions.some(v=>!Number.isFinite(v)||v*scale<.1||v*scale>5))throw Error('Each internal chamber dimension must be 0.1–5 m.');
  const number=v=>v===null||v===undefined||String(v).trim()===''?NaN:Number(v);
  const supply=number(input.supply),exhaust=number(input.exhaust),leak=number(input.leak);
  if(!Number.isFinite(supply)||!Number.isFinite(exhaust)||supply<0||exhaust<0||supply>1000||exhaust>1000||!Number.isFinite(leak)||leak<.000001||leak>1)throw Error('Use finite nonnegative flows up to 1000 m³/h and leakage 0.000001–1 m³/s/√Pa.');
  const dimensionBasis=input.dimensionBasis??'PROPOSED';
  if(!['PROPOSED','USER_MEASURED'].includes(dimensionBasis))throw Error('Choose a dimension evidence label.');
  return {schema:'sure2-chamber-1',width_m:dimensions[0]*scale,depth_m:dimensions[1]*scale,height_m:dimensions[2]*scale,
    dimension_basis:dimensionBasis,supply_m3h:supply,exhaust_m3h:exhaust,leak_m3s_sqrtPa:leak,
    flow_basis:'USER_ENTERED_ASSUMPTIONS',notes:String(input.notes??'').slice(0,2000)};
}
function cuboid(id,name,kind,lo,hi,extras={}){
 const [x,y,z]=lo,[X,Y,Z]=hi;
 return {id,name,class:kind,storey:'Chamber',bbox:[lo,hi],vertices:[x,y,z,X,y,z,X,Y,z,x,Y,z,x,y,Z,X,y,Z,X,Y,Z,x,Y,Z],
   faces:[0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7],...extras};
}
export function buildChamber(input){
 const s=chamberSettings(input),{width_m:w,depth_m:d,height_m:h}=s,t=.008;
 const dimensions=s.dimension_basis==='PROPOSED'?'Proposed dimensions — confirm at the chamber':'Dimensions user-declared as measured — not independently verified';
 const properties={ChamberSetup:{DimensionEvidence:dimensions,FlowEvidence:s.flow_basis,Notes:s.notes,GeometryScope:'Schematic shell only; actual opening, partition, fan and tubing positions are not specified.'}};
 const entities=[cuboid(CHAMBER_ID,'CHAMBER','IfcSpace',[0,0,0],[w,d,h],{volume_m3:w*d*h,properties}),
   cuboid('SHELL_FLOOR','Schematic floor','IfcSlab',[-t,-t,-t],[w+t,d+t,0]),
   cuboid('SHELL_LID','Schematic lid','IfcSlab',[-t,-t,h],[w+t,d+t,h+t]),
   cuboid('SHELL_LEFT','Schematic left panel','IfcWall',[-t,-t,0],[0,d+t,h]),
   cuboid('SHELL_RIGHT','Schematic right panel','IfcWall',[w,-t,0],[w+t,d+t,h]),
   cuboid('SHELL_FRONT','Schematic front panel','IfcWall',[0,-t,0],[w,0,h]),
   cuboid('SHELL_BACK','Schematic back panel','IfcWall',[0,d,0],[w,d+t,h])];
 return {schema:'pci-bim-1',source:{name:'Sure2 chamber — '+(s.dimension_basis==='PROPOSED'?'proposed geometry':'user-entered dimensions'),geometry_units:'m',axis:'XYZ; Z vertical',note:dimensions+'. Shell thickness is schematic. Pressure inputs are assumptions.'},
   entities,candidate_links:[],import_report:{geometry_missing:[]},engineering:blankEngineering(),chamberSetup:s};
}
export function chamberNetworkValues(s){
 if(s?.schema!=='sure2-chamber-1')throw Error('Unsupported chamber setup.');
 const verified=chamberSettings({units:'m',width:s.width_m,depth:s.depth_m,height:s.height_m,supply:s.supply_m3h,exhaust:s.exhaust_m3h,leak:s.leak_m3s_sqrtPa,dimensionBasis:s.dimension_basis});
 return {supply:verified.supply_m3h/3600,exhaust:verified.exhaust_m3h/3600,leak:verified.leak_m3s_sqrtPa};
}
