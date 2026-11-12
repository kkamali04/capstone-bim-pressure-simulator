import {measureVolume} from './geometry-volume.js';
// Shared browser/Node importer. Geometry from web-ifc is SI, Y-up; PCI stores Z-up.
export function convertIFC(api,W,bytes,name,onProgress=()=>{}) {
 const envelope=new TextDecoder().decode(bytes);const clean=envelope.replace(/\/\*[\s\S]*?\*\//g,'').trim();
 if(!/^ISO-10303-21\s*;/i.test(clean)||!/END-ISO-10303-21\s*;\s*$/i.test(clean)||!/(?:^|;)\s*DATA\s*;/i.test(clean)||!/(?:^|;)\s*HEADER\s*;/i.test(clean))throw Error('Incomplete or invalid IFC STEP file. Export a complete IFC2x3 or IFC4 file.');
 const modelID=api.OpenModel(bytes,{COORDINATE_TO_ORIGIN:false,ALLOW_INCOMPATIBLE_SCHEMA_ALIASES:false});
 if(modelID<0)throw Error('IFC parser could not open this model. Export a supported IFC2x3 or IFC4 file.');
 try {
 const ids=type=>{const v=api.GetLineIDsWithType(modelID,type,true);return Array.from({length:v.size()},(_,i)=>v.get(i));};
 const read=id=>api.GetLine(modelID,id),val=x=>x?.value;
 const parents=new Map,propertySets=new Map,typeDefinitions=new Map;
 const scalar=x=>x==null?null:typeof x==='object'&&'value'in x?x.value:typeof x==='string'||typeof x==='number'||typeof x==='boolean'?x:null;
 function propertySet(id){
  const set=read(id),result={};
  for(const ref of set.HasProperties??set.Quantities??[]){
   const p=read(val(ref)),key=val(p.Name);if(!key)continue;
   if(p.NominalValue!=null)result[key]=scalar(p.NominalValue);
   else if(p.EnumerationValues||p.ListValues)result[key]=(p.EnumerationValues??p.ListValues).map(scalar);
   else {const field=['LengthValue','AreaValue','VolumeValue','CountValue','WeightValue','TimeValue'].find(k=>p[k]!=null);if(field)result[key]={value:scalar(p[field]),quantity:field,unit: p.Unit?val(read(val(p.Unit)).Name)??'IFC explicit unit':'IFC project units'};}
  }
  return {name:val(set.Name)||'Unnamed property set',values:result};
 }
 for(const id of ids(W.IFCRELDEFINESBYPROPERTIES)){
  const r=read(id),ref=val(r.RelatingPropertyDefinition);if(!ref)continue;
  const set=propertySet(ref);for(const object of r.RelatedObjects??[]){const key=val(object);if(!propertySets.has(key))propertySets.set(key,{});propertySets.get(key)[set.name]=set.values;}
 }
 for(const id of ids(W.IFCRELDEFINESBYTYPE)){
  const r=read(id),type=read(val(r.RelatingType)),sets={};
  for(const ref of type.HasPropertySets??[]){const set=propertySet(val(ref));sets[set.name]=set.values;}
  for(const object of r.RelatedObjects??[])typeDefinitions.set(val(object),{id:val(type.GlobalId)||null,name:val(type.Name)||val(type.ElementType)||null,properties:sets});
 }
 function details(id,line){
  const type=typeDefinitions.get(id),properties={...(type?.properties??{})};
  for(const [set,values] of Object.entries(propertySets.get(id)??{}))properties[set]={...(properties[set]??{}),...values};
  const entries=Object.values(properties).flatMap(Object.entries);
  const lookup=names=>entries.find(([key,value])=>names.includes(key.toLowerCase().replace(/[^a-z0-9]/g,''))&&typeof value==='string')?.[1]??null;
  let parent=parents.get(id),contained_in_space=null;const visited=new Set;
  while(parent&&!visited.has(parent)){visited.add(parent);const r=read(parent);if(r.type===W.IFCSPACE){contained_in_space=val(r.GlobalId);break;}parent=parents.get(parent);}
  return {properties,metadata:{manufacturer:lookup(['manufacturer','manufacturername']),model:lookup(['model','modelnumber','modelreference','articlenumber']),typeName:type?.name??val(line.ObjectType)??null,typeId:type?.id??null},contained_in_space};
 }

 for(const [type,list] of [[W.IFCRELAGGREGATES,'RelatedObjects'],[W.IFCRELCONTAINEDINSPATIALSTRUCTURE,'RelatedElements']])
  for(const id of ids(type)){const r=read(id);for(const child of r[list]??[])parents.set(val(child),val(r.RelatingObject??r.RelatingStructure));}
 const storey=id=>{for(let i=0;i<12&&id;i++){const r=read(id);if(r.type===W.IFCBUILDINGSTOREY)return val(r.Name)||'Unnamed storey';id=parents.get(id);}return 'Unassigned';};
 const entities=[],done=new Set,failed=[];let triangleCount=0;
 const classNames=new Map(['IfcSpace','IfcDoor','IfcWindow','IfcWall','IfcWallStandardCase','IfcSlab','IfcRoof','IfcStair','IfcStairFlight','IfcRailing','IfcFurnishingElement','IfcBuildingElementProxy'].map(n=>[W[n.toUpperCase()],n]));
 function mesh(flat){
  if(done.has(flat.expressID))return;done.add(flat.expressID);const line=read(flat.expressID);
  if(!line.GlobalId||line.type===W.IFCOPENINGELEMENT)return;
  const vertices=[],faces=[];
  for(let j=0;j<flat.geometries.size();j++){
   const pg=flat.geometries.get(j),geo=api.GetGeometry(modelID,pg.geometryExpressID),a=api.GetVertexArray(geo.GetVertexData(),geo.GetVertexDataSize()),ix=api.GetIndexArray(geo.GetIndexData(),geo.GetIndexDataSize()),m=pg.flatTransformation,offset=vertices.length/3;
   for(let k=0;k<a.length;k+=6){const x=a[k],y=a[k+1],z=a[k+2];const X=m[0]*x+m[4]*y+m[8]*z+m[12],Y=m[1]*x+m[5]*y+m[9]*z+m[13],Z=m[2]*x+m[6]*y+m[10]*z+m[14];vertices.push(X,-Z,Y);}
   for(const i of ix)faces.push(i+offset);geo.delete();
  }
  if(!vertices.length){failed.push({id:val(line.GlobalId),reason:'No renderable geometry'});return;}
  triangleCount+=faces.length/3;
  if(entities.length>=2000||triangleCount>600000)throw Error('Model exceeds browser limits (2,000 objects / 600,000 triangles). Export one floor or a smaller building subset.');
  const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(let k=0;k<vertices.length;k++) {const d=k%3;lo[d]=Math.min(lo[d],vertices[k]);hi[d]=Math.max(hi[d],vertices[k]);}
  const cl=classNames.get(line.type)||line.constructor.name.replace(/^Ifc/,'Ifc');
  const e={id:val(line.GlobalId),class:cl,name:val(line.Name)||cl,longName:val(line.LongName)||null,storey:storey(flat.expressID),bbox:[lo,hi],vertices,faces,...details(flat.expressID,line)};
  if(line.type===W.IFCSPACE){const result=measureVolume(vertices,faces);e.volume_m3=result.volume;e.volume_quality=result.quality;e.volume_basis=result.basis;}
  entities.push(e);if(entities.length%50===0)onProgress('Parsed '+entities.length+' objects…');
 }
 api.StreamAllMeshes(modelID,mesh);
 const spaces=ids(W.IFCSPACE);api.StreamMeshes(modelID,spaces.filter(id=>!done.has(id)),mesh);
 if(!entities.length)throw Error('No renderable geometry found. Export IFC2x3 or IFC4 with product Body geometry enabled; an empty file or property-only export cannot be displayed.');
 // Compare represented products with emitted meshes: parser success does not imply every product rendered.
 const rendered=new Set(entities.map(e=>e.id)),missingIds=new Set(failed.map(e=>e.id));
 for(const id of ids(W.IFCPRODUCT)){const line=read(id),guid=val(line.GlobalId);if(line.Representation&&line.type!==W.IFCOPENINGELEMENT&&!rendered.has(guid)&&!missingIds.has(guid)){failed.push({id:guid,name:val(line.Name)||null,reason:'IFC product has a representation but the parser emitted no renderable mesh'});missingIds.add(guid);}}
 const parser_diagnostics=[];
 if(typeof api.GetAndClearErrors==='function'){const errors=api.GetAndClearErrors(modelID);for(let i=0;i<errors.size();i++){const e=errors.get(i);parser_diagnostics.push({message:e.message??String(e),type:e.type??null,expressID:e.expressID??null});}}

 const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(const e of entities)for(let d=0;d<3;d++){lo[d]=Math.min(lo[d],e.bbox[0][d]);hi[d]=Math.max(hi[d],e.bbox[1][d]);}
 const origin=[(lo[0]+hi[0])/2,(lo[1]+hi[1])/2,0];for(const e of entities){e.vertices=e.vertices.map((v,k)=>v-origin[k%3]);e.bbox=e.bbox.map(b=>b.map((v,k)=>v-origin[k]));}
 const doors=new Map;
 for(const id of ids(W.IFCRELSPACEBOUNDARY)){const r=read(id);if(!r.RelatedBuildingElement||!r.RelatingSpace)continue;const door=read(val(r.RelatedBuildingElement));if(door.type!==W.IFCDOOR)continue;const key=val(door.GlobalId);if(!doors.has(key))doors.set(key,new Set);doors.get(key).add(val(read(val(r.RelatingSpace)).GlobalId));}
 const candidate_links=Array.from(doors,([door_id,set])=>{const a=[...set].sort();return{door_id,a:a[0],b:a.length===2?a[1]:null,basis:a.length===2?'IfcRelSpaceBoundary / IfcDoor':'Unresolved endpoint; manual review required',reviewed:false};});
 const counts={};for(const e of entities)counts[e.class]=(counts[e.class]||0)+1;
 return{schema:'pci-bim-1',source:{name,ifc_schema:api.GetModelSchema(modelID),parser_version:'web-ifc 0.0.77',geometry_units:'m',axis:'XYZ; Z vertical',display_origin_translation_m:origin},entities,candidate_links,counts,import_report:{spaces:counts.IfcSpace??0,simulation_ready:false,geometry_success:entities.length,geometry_missing:failed,parser_diagnostics,completeness:'Unverified: compare this view with the authoring model. Unsupported or omitted representations may not produce parser diagnostics.'},missing:['Measured supply/exhaust flow','Reviewed leakage and complete airflow connections','Sensor reference and time alignment','Calibration and held-out validation'],limitations:[...(!counts.IfcSpace?['No IfcSpace room geometry: viewing only. Export room spaces to prepare a pressure model.']:[]),'Room-uniform reduced-order model; no within-room CFD.','Geometry and volumes require review.']};
 }finally{api.CloseModel(modelID);}
}
