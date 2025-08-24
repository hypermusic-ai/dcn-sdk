from eth_account import Account
import dcn

def main() :
    acc = Account.create()
    sdk_client = dcn.Client()

    sdk_client.login_with_account(acc)

    exec_result = sdk_client.execute("test1", 5, [(0,0),(0,0),(0,0),(0,0),(0,0),(0,0)])
    print(exec_result)

    #post_transform = sdk_client.transformation_post(dcn.TransformationCreateRequest("t1", "return x + args[0];"))
    #print(post_transform)

    # feature_post = sdk_client.feature_post(
    #     dcn.FeatureCreateRequest("f1", 
    #     [
    #         dcn.FeatureDimensionCreateRequest("pitch", 
    #         [
    #             dcn.TransformationRef("t1", [1])
    #         ])
    #     ]))
    
    feature_post = sdk_client.feature_post({
        "name": "f3",
        "dimensions": [
            {
                "feature_name": "pitch",
                "transformations": [
                    {"name": "t1", "args": [1]}
                ]
            }
        ]
    })
    print(feature_post)

if __name__ == "__main__":
    main()
