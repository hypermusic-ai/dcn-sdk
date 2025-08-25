from eth_account import Account
import dcn

def main() :
    acc = Account.create()
    sdk_client = dcn.Client()

    sdk_client.login_with_account(acc)

    version_response = sdk_client.version()
    #print(version_response["version"])
    print(version_response.version)
    print(version_response.build_timestamp)

    exec_result = sdk_client.execute("test1", 5, [(0,0),(0,0),(0,0),(0,0),(0,0),(0,0)])

    # print(exec_result[0].feature_path)
    # print(exec_result[0].data)

    # get_transform = sdk_client.transformation_get("add")
    # print(get_transform.address)
    # print(get_transform.local_address)
    # print(get_transform.name)
    # print(get_transform.owner)
    # print(get_transform.sol_src)

    get_feature = sdk_client.feature_get("f1")
    print(get_feature.address)
    print(get_feature.dimensions[0].feature_name)
    print(get_feature.local_address)
    print(get_feature.name)
    print(get_feature.owner)

    


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
    
    # feature_post = sdk_client.feature_post({
    #     "name": "f3",
    #     "dimensions": [
    #         {
    #             "feature_name": "pitch",
    #             "transformations": [
    #                 {"name": "t1", "args": [1]}
    #             ]
    #         }
    #     ]
    # })
    # print(feature_post)

if __name__ == "__main__":
    main()
