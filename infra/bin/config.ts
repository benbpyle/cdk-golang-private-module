import { Options } from "../lib/types/options";

export const getConfig = (stackPrefix: string, stackName: string): Options => {
    return {
        codeCommitAccount: "982072850275",
        defaultRegion: "us-west-2",
        devAccount: "904442064295",
        productionAccount: "966605421973",
        qaAccount: "627915793329",
        stagingAccount: "442359213736",
        toolsAccount: "909408398654",
        pipelineName: `${stackPrefix}-${stackName}-pipeline`,
        stackName: stackName,
        stackNamePrefix: stackPrefix,
        reposName: "fhir-utils-example",
        cdkBootstrapQualifier: "hnb659fds",
    };
};
