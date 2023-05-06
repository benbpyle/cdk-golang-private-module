import * as cdk from "aws-cdk-lib";
import { StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { Repository } from "aws-cdk-lib/aws-codecommit";
import {
    CodeBuildStep,
    CodePipeline,
    CodePipelineSource,
    ShellStep,
} from "aws-cdk-lib/pipelines";
import * as options from "../types/options";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import {
    BuildEnvironmentVariableType,
    BuildSpec,
    LinuxBuildImage,
} from "aws-cdk-lib/aws-codebuild";
import { PipelineAppStage } from "./pipeline-app-stage";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";

interface PipelineStackProps extends StackProps {
    options: options.Options;
}

export class PipelineStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: PipelineStackProps) {
        super(scope, id, props);

        const repos = Repository.fromRepositoryArn(
            this,
            `${props?.options.stackNamePrefix}-${props?.options.stackName}-repository`,
            `arn:aws:codecommit:${props?.options.defaultRegion}:${props?.options.codeCommitAccount}:${props?.options.reposName}`
        );
        const pipeline = new CodePipeline(
            this,
            `${props?.options.stackNamePrefix}-${props?.options.stackName}-Pipeline`,
            {
                crossAccountKeys: true,
                selfMutation: true,
                pipelineName: `${props.options.stackNamePrefix}-${props.options.reposName}-pipeline`,
                dockerEnabledForSynth: true,
                synth: new CodeBuildStep("Synth", {
                    input: CodePipelineSource.codeCommit(repos, "main"),
                    buildEnvironment: {
                        buildImage: LinuxBuildImage.STANDARD_6_0,
                        environmentVariables: {
                            GITHUB_USERNAME: {
                                value: "fhir-github-access-token:githubUsername",
                                type: BuildEnvironmentVariableType.SECRETS_MANAGER,
                            },
                            GITHUB_TOKEN: {
                                value: "fhir-github-access-token:githubToken",
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
                        "export GOPRIVATE=github.com/curantis-solutions",
                        "npx cdk synth",
                    ],
                }),
                selfMutationCodeBuildDefaults: {
                    rolePolicy: [
                        new PolicyStatement({
                            sid: "CcAccountRole",
                            effect: Effect.ALLOW,
                            actions: ["sts:AssumeRole"],
                            resources: [
                                // CodeCommit account cdk roles - to allow for update of the support stack during self mutation
                                `arn:aws:iam::${props?.options.codeCommitAccount}:role/cdk-${props?.options.cdkBootstrapQualifier}-deploy-role-${props?.options.codeCommitAccount}-${this.region}`,
                                `arn:aws:iam::${props?.options.codeCommitAccount}:role/cdk-${props?.options.cdkBootstrapQualifier}-file-publishing-role-${props?.options.codeCommitAccount}-${this.region}`,
                            ],
                        }),
                    ],
                },
            }
        );

        pipeline.addStage(
            new PipelineAppStage(this, `DevDeployment`, {
                env: {
                    account: props?.options?.qaAccount,
                    region: props?.options?.defaultRegion,
                },
            })
        );
    }
}
