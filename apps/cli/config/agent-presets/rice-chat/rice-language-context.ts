/** Inject the configured reply language into each rice-chat request. */

import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

export const name = 'rice-language-context'
export const inject = ['agents', 'settings']

const LOCALE_NAMESPACE = settingsNamespace('locale')

function configuredInstruction(preference: unknown): string | undefined {
  if (preference === 'en') {
    return 'All user-facing text in this turn must be in English, including answers, explanations, follow-up questions, options, and recommendations. Do not provide a bilingual answer unless the user explicitly asks for one. Preserve proper names, variety names, pesticide names, field names, raw data fields, and tool-result identifiers as written.'
  }
  if (preference === 'fr') {
    return 'Tout le texte destiné à l’utilisateur dans ce tour doit être en français, y compris les réponses, explications, questions de suivi, options et recommandations. Ne fournissez pas de réponse bilingue sauf si l’utilisateur le demande explicitement. Conservez tels quels les noms propres, noms de variétés, noms de pesticides, noms de parcelles, champs de données bruts et identifiants des résultats d’outils. Utilisez obligatoirement une terminologie professionnelle française de l’agronomie, de la riziculture, de l’entomologie et de la phytopathologie : traitez les termes chinois de la source comme des termes techniques, jamais comme une phrase à traduire littéralement. Préservez toujours l’identité biologique et agronomique : ne remplacez pas un ravageur, pathogène, adventice, stade de croissance, matière active, engrais ou opération culturale par un mot courant ou une autre catégorie. En cas d’équivalent français incertain, n’inventez pas de nom : employez une catégorie professionnelle exacte et conservez le terme scientifique ou source entre parenthèses si cela est nécessaire à la précision. N’inférez jamais une espèce ou une matière active qui n’est pas explicitement donnée. Exemple de contrôle : 稻飞虱 = « planthoppers du riz » ou « fulgores du riz », jamais « puceron(s) » ; 褐飞虱 explicitement indiqué = « planthopper brun du riz (Nilaparvata lugens) ». '
  }
}

export function apply(ctx: Context): void {
  ctx.on('agent/pre-step', async ({ signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    const locale = ctx.settings.get(LOCALE_NAMESPACE) as { preference?: unknown } | undefined
    const text = configuredInstruction(locale?.preference)
    // Chinese is the default model language; adding a second language prompt is
    // unnecessary and makes the transcript noisier.
    if (!text) return decision
    return {
      kind: 'enter',
      messages: [
        ...decision.messages,
        createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'plugin', plugin: name, form: 'snapshot', sections: [{ name, text }] },
        }),
      ],
    }
  }, { prepend: true })
}
