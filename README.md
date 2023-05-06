# Golang Private Module Build

Supports the article posted @ [Binaryheap.com](https://www.binaryheap.com/golang-private-module-with-cdk-codebuild/)

![Image](https://i0.wp.com/www.binaryheap.com/wp-content/uploads/2023/05/Private_Repos.png?w=1180&ssl=1)

The purpose of this repository is to demonstrate how to utilize a Golang private module. This repository contains

-   A CDK Pipeline
-   A custom CodeBuild for pulling the private code from the <insert your private GitHub repos>
-   A simple Lambda function that includes the private repos and makes a dummy call
