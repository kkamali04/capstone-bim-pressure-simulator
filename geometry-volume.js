// Weld duplicate render vertices, check closed edges, and consistently orient each component.
export function measureVolume(vertices,faces){
 const keyToID=new Map,points=[],weld=[];
 for(let k=0;k<vertices.length;k+=3){const p=vertices.slice(k,k+3),key=p.map(v=>Math.round(v*1e6)).join(',');if(!keyToID.has(key)){keyToID.set(key,points.length);points.push(p);}weld.push(keyToID.get(key));}
 const triangles=[];for(let k=0;k<faces.length;k+=3){const t=faces.slice(k,k+3).map(i=>weld[i]);if(new Set(t).size===3)triangles.push(t);}
 const edges=new Map;triangles.forEach((t,i)=>{for(let j=0;j<3;j++){const a=t[j],b=t[(j+1)%3],key=Math.min(a,b)+':'+Math.max(a,b);if(!edges.has(key))edges.set(key,[]);edges.get(key).push({i,sign:a<b?1:-1});}});
 const badEdges=[...edges.values()].filter(a=>a.length!==2).length;
 const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(const p of points)for(let d=0;d<3;d++){lo[d]=Math.min(lo[d],p[d]);hi[d]=Math.max(hi[d],p[d]);}
 const bbox=(hi[0]-lo[0])*(hi[1]-lo[1])*(hi[2]-lo[2]);
 if(badEdges||!triangles.length)return{volume:bbox,quality:'approximate',basis:'Bounding-box estimate: mesh has '+badEdges+' open/nonmanifold edges; replace with surveyed/declared room volume'};
 const adjacency=triangles.map(()=>[]);for(const pair of edges.values()){const[a,b]=pair;adjacency[a.i].push([b.i,-a.sign*b.sign]);adjacency[b.i].push([a.i,-a.sign*b.sign]);}
 const signs=new Int8Array(triangles.length);let volume=0,conflict=false;
 for(let seed=0;seed<triangles.length;seed++)if(!signs[seed]){let subtotal=0;const queue=[seed];signs[seed]=1;for(let k=0;k<queue.length;k++){const i=queue[k],t=triangles[i],a=points[t[0]].map((v,d)=>v-lo[d]),b=points[t[1]].map((v,d)=>v-lo[d]),c=points[t[2]].map((v,d)=>v-lo[d]);subtotal+=signs[i]*(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;for(const[j,s]of adjacency[i]){const desired=signs[i]*s;if(signs[j]&&signs[j]!==desired)conflict=true;else if(!signs[j]){signs[j]=desired;queue.push(j);}}}volume+=Math.abs(subtotal);}
 if(conflict||volume<=1e-6||volume>bbox*1.001)return{volume:bbox,quality:'approximate',basis:'Bounding-box estimate: inconsistent or overlapping mesh; replace with reviewed room volume'};
 return{volume,quality:'closed-mesh',basis:'Closed-edge mesh volume after consistent triangle orientation; nested voids/enclosure require review'};
}
