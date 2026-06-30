import { jsonSchemaForPromptArguments } from './jsonSchemaForPromptArguments.ts'
import { parsePromptMarkdown } from './parsePromptMarkdown.ts'
import { promptNameForFile } from './promptNameForFile.ts'

/*
onLoad rewrite for a src/mcp/prompts/<file>.md prompt. Prompts are MCP-only —
the client target gets an empty stub (defensive: a stray import can't drag the
prompt body into the browser bundle). The server target parses the frontmatter
(description + arguments) and body once and emits a module that registers the
prompt via definePrompt, embedding the body as a string the render closure
interpolates `{{name}}` placeholders into at call time. Returns undefined when
the path isn't under promptsDir so other loaders see the module.
*/
export async function rewritePromptModule(
    path: string,
    promptsDir: string,
    target: 'server' | 'client',
    importName: string,
): Promise<{ contents: string; loader: 'ts' } | undefined> {
    if (!path.startsWith(`${promptsDir}/`)) {
        return undefined
    }
    if (target === 'client') {
        return { contents: 'export {}', loader: 'ts' }
    }
    const relativePath = path.slice(promptsDir.length + 1)
    const source = await Bun.file(path).text()
    const name = promptNameForFile(relativePath)
    const parsed = parsePromptMarkdown(source)
    const jsonSchema = jsonSchemaForPromptArguments(parsed.arguments)
    const optionLines = [
        parsed.description ? `    description: ${JSON.stringify(parsed.description)},` : undefined,
        jsonSchema ? `    jsonSchema: ${JSON.stringify(jsonSchema)},` : undefined,
        `    render: (args) => __belteRenderPromptTemplate__(__template__, args),`,
    ]
        .filter((line) => line !== undefined)
        .join('\n')
    const contents = `import { definePrompt as __belteDefinePrompt__ } from '${importName}/server/prompts/definePrompt'
import { renderPromptTemplate as __belteRenderPromptTemplate__ } from '${importName}/server/prompts/renderPromptTemplate'
const __template__ = ${JSON.stringify(parsed.body)}
export const prompt = __belteDefinePrompt__(${JSON.stringify(name)}, {
${optionLines}
})
`
    return { contents, loader: 'ts' }
}
