import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
export type ProductionParams = { projectId: string };
export class ProductionWorkflow extends WorkflowEntrypoint<Env, ProductionParams> {
  async run(event: WorkflowEvent<ProductionParams>, step: WorkflowStep) {
    return step.do('initialize', async () => ({ projectId: event.payload.projectId }));
  }
}
