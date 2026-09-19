import { chmod, readFile, writeFile } from "node:fs/promises";

/** Add daemon state to a command-specific Docker fake. No production mock seam. */
export async function trackFakeDocker(executable: string): Promise<void> {
  const source = await readFile(executable, "utf8");
  const implementation = `${executable}.implementation.${/^import |^export /mu.test(source) ? "mjs" : "cjs"}`;
  await writeFile(implementation, source, { mode: 0o755 });
  await chmod(implementation, 0o755);
  await writeFile(
    executable,
    `#!${process.execPath}
const fs=require("node:fs");
const crypto=require("node:crypto");
const {spawn}=require("node:child_process");
const args=process.argv.slice(2);
if(args[0]==="info"){const marker=${JSON.stringify(`${executable}.daemon-id`)};console.log(JSON.stringify(fs.existsSync(marker)?fs.readFileSync(marker,"utf8"):"fake-daemon"));process.exit(0)}
const filename=${JSON.stringify(`${executable}.containers.json`)};
let containers=fs.existsSync(filename)?JSON.parse(fs.readFileSync(filename,"utf8")):[];
const save=()=>fs.writeFileSync(filename,JSON.stringify(containers));
if(args[0]==="container"&&args[1]==="inspect"){
  const found=containers.find(value=>value.name==="/"+args.at(-1)||value.id===args.at(-1));
  if(found){console.log(JSON.stringify(found));process.exit(0)}
  process.stderr.write("Error: No such container: "+args.at(-1));process.exit(1);
}
if(args[0]==="run"){
  const labels={};for(let i=0;i<args.length-1;i++)if(args[i]==="--label"){const [key,...value]=args[i+1].split("=");labels[key]=value.join("=")}
  containers.push({id:crypto.randomBytes(32).toString("hex"),name:"/"+args[args.indexOf("--name")+1],labels});save();
}
const child=spawn(${JSON.stringify(implementation)},args,{stdio:"inherit"});
child.on("error",()=>process.exit(127));
child.on("exit",(code,signal)=>{
  if(args[0]==="rm"&&code===0){containers=containers.filter(value=>value.id!==args.at(-1)&&value.name!=="/"+args.at(-1));save()}
  if(signal)process.kill(process.pid,signal);else process.exit(code??1);
});
`,
    { mode: 0o755 },
  );
  await chmod(executable, 0o755);
}
