import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";
import { ExampleFunc } from "./functions/example-func";

export class MainStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: cdk.StackProps) {
        super(scope, id, props);

        new ExampleFunc(this, "ExampleFunc");
    }
}
