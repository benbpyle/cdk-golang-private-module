import { GoFunction } from "@aws-cdk/aws-lambda-go-alpha";
import { Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as path from "path";

export class ExampleFunc extends Construct {
    constructor(scope: Construct, id: string) {
        super(scope, id);

        new GoFunction(scope, `ExampleFuncHandler`, {
            entry: path.join(__dirname, `../../../src/example-func`),
            functionName: `example-func`,
            timeout: Duration.seconds(30),
            bundling: {
                goBuildFlags: ['-ldflags "-s -w"'],
            },
        });
    }
}
