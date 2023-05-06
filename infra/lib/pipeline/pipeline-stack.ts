import * as cdk from "aws-cdk-lib";
import { SecretValue, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { Repository } from "aws-cdk-lib/aws-codecommit";
import {
    CodeBuildStep,
    CodePipeline,
    CodePipelineSource,
    ShellStep,
} from "aws-cdk-lib/pipelines";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import {
    BuildEnvironmentVariableType,
    BuildSpec,
    LinuxBuildImage,
} from "aws-cdk-lib/aws-codebuild";
import { PipelineAppStage } from "./pipeline-app-stage";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";

export class PipelineStack extends cdk.Stack {
    constructor(scope: Construct, id: string) {
        super(scope, id);

        const pipeline = new CodePipeline(this, "Pipeline", {
            pipelineName: "SamplePipeline",
            dockerEnabledForSynth: true,
            synth: new CodeBuildStep("Synth", {
                input: CodePipelineSource.gitHub(
                    "benbpyle/cdk-step-functions-local-testing",
                    "main",
                    {
                        authentication: SecretValue.secretsManager(
                            "sf-sample",
                            {
                                jsonField: "github",
                            }
                        ),
                    }
                ),

                buildEnvironment: {
                    buildImage: LinuxBuildImage.STANDARD_6_0,
                    environmentVariables: {
                        GITHUB_USERNAME: {
                            value: "benbpyle",
                            type: BuildEnvironmentVariableType.PLAINTEXT,
                        },
                        GITHUB_TOKEN: {
                            value: "sf-sample:github",
                            type: BuildEnvironmentVariableType.SECRETS_MANAGER,
                        },
                    },
                },
                partialBuildSpec: BuildSpec.fromObject({
                    phases: {
                        install: {
                            "runtime-versions": {
                                golang: "1.18",
                            },
                        },
                    },
                }),

                commands: [
                    'echo "machine github.com login $GITHUB_USERNAME password $GITHUB_TOKEN" >> ~/.netrc',
                    "npm i",
                    "export GOPRIVATE=github.com/benbpyle",
                    "npx cdk synth",
                ],
            }),
        });

        pipeline.addStage(new PipelineAppStage(this, `Deploy`, {}));
    }
}
