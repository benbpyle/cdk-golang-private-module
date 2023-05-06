import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { MainStack } from "../main-stack";

export class PipelineAppStage extends cdk.Stage {
    constructor(scope: Construct, id: string, props: cdk.StageProps) {
        super(scope, id, props);

        new MainStack(this, `FhirUtilsExample-App`, {});
    }
}
